-- Pure Lua line editor with cursor movement, history, and multiline support
-- No external dependencies beyond standard POSIX terminal

local M = {}

-- History storage
local history = {}
local history_pos = 0
local max_history = 100

-- Terminal control
local function enable_raw_mode()
    os.execute("stty -echo -icanon min 1 time 0 2>/dev/null")
    -- Enable bracketed paste mode
    io.write("\27[?2004h")
    -- Enable kitty keyboard protocol (progressive enhancement flags=1)
    -- This makes Shift+Enter send ESC [ 13 ; 2 u in ghostty/kitty
    io.write("\27[>1u")
    io.flush()
end

local function disable_raw_mode()
    -- Disable kitty keyboard protocol
    io.write("\27[<u")
    -- Disable bracketed paste mode
    io.write("\27[?2004l")
    io.flush()
    os.execute("stty echo icanon 2>/dev/null")
end

-- Debug mode
local DEBUG = os.getenv("READLINE_DEBUG") == "1"
local debug_file = nil

-- Blind mode: hide input as user types (like speaking)
local BLIND_MODE = os.getenv("CHATBOT_BLIND") == "1"
local blind_char_count = 0
local blind_indicator_chars = {"·", "•", "◦", "∘"}  -- subtle breathing dots

local function debug_log(msg)
    if not DEBUG then return end
    if not debug_file then
        debug_file = io.open("readline_debug.log", "a")
    end
    if debug_file then
        debug_file:write(msg .. "\n")
        debug_file:flush()
    end
end

-- Get terminal width
local function get_term_width()
    local handle = io.popen("tput cols 2>/dev/null")
    if handle then
        local result = handle:read("*a")
        handle:close()
        local width = tonumber(result)
        if width and width > 0 then
            return width
        end
    end
    return 80  -- fallback
end

-- Read a single byte
local function read_byte()
    local char = io.read(1)
    if char then
        local b = char:byte()
        debug_log(string.format("byte: %d (0x%02x) %s", b, b, b >= 32 and b < 127 and string.char(b) or ""))
        return b
    end
    return nil
end

-- Read until we see the bracketed paste end sequence
local function read_bracketed_paste()
    local content = {}
    while true do
        local b = read_byte()
        if not b then break end

        -- Check for ESC (start of end sequence: ESC [ 2 0 1 ~)
        if b == 27 then
            local b2 = read_byte()
            if b2 == 91 then -- '['
                local b3 = read_byte()
                if b3 == 50 then -- '2'
                    local b4 = read_byte()
                    if b4 == 48 then -- '0'
                        local b5 = read_byte()
                        if b5 == 49 then -- '1'
                            local b6 = read_byte()
                            if b6 == 126 then -- '~' - end of paste
                                break
                            end
                        end
                    end
                end
            end
        else
            table.insert(content, string.char(b))
        end
    end
    return table.concat(content)
end

-- Parse escape sequence, returns: action_name, [extra_data]
local function read_escape_sequence()
    local b = read_byte()
    if not b then return nil end

    debug_log(string.format("escape seq start: %d", b))

    -- Alt+Enter (ESC followed by CR)
    if b == 13 then
        debug_log("recognized: alt+enter (newline)")
        return "newline"
    end

    -- CSI sequence: ESC [
    if b == 91 then -- '['
        local seq = read_byte()
        if not seq then return nil end

        -- Arrow keys
        if seq == 65 then return "up" end
        if seq == 66 then return "down" end
        if seq == 67 then return "right" end
        if seq == 68 then return "left" end
        if seq == 72 then return "home" end
        if seq == 70 then return "end" end

        -- Numeric sequences
        if seq >= 48 and seq <= 57 then -- digit
            local num = seq - 48
            local next_b = read_byte()

            -- Multi-digit number
            while next_b and next_b >= 48 and next_b <= 57 do
                num = num * 10 + (next_b - 48)
                next_b = read_byte()
            end

            -- Check for modifier (;)
            if next_b == 59 then -- ';'
                local modifier = 0
                next_b = read_byte()
                while next_b and next_b >= 48 and next_b <= 57 do
                    modifier = modifier * 10 + (next_b - 48)
                    next_b = read_byte()
                end

                -- CSI u encoding (kitty keyboard protocol)
                -- ESC [ keycode ; modifier u
                -- Modifier: 1 + (shift?1:0) + (alt?2:0) + (ctrl?4:0)
                -- Plain Enter = 13;1u, Shift+Enter = 13;2u, Ctrl+Enter = 13;5u
                debug_log(string.format("CSI u: num=%d modifier=%d next_b=%d", num, modifier, next_b or -1))
                if next_b == 117 then -- 'u'
                    if num == 13 then
                        if modifier == 1 then
                            debug_log("recognized: enter (submit)")
                            return "enter"  -- Plain Enter (submit)
                        else
                            debug_log("recognized: modified enter (newline)")
                            return "newline"  -- Modified Enter (new line)
                        end
                    end
                    -- Ctrl+C = 99;5u (c=99, ctrl=5)
                    if num == 99 and modifier == 5 then
                        debug_log("recognized: ctrl+c")
                        return "ctrl_c"
                    end
                    -- Ctrl+D = 100;5u (d=100, ctrl=5)
                    if num == 100 and modifier == 5 then
                        debug_log("recognized: ctrl+d")
                        return "ctrl_d"
                    end
                end

                -- xterm modifyOtherKeys: ESC [ 27 ; 2 ; 13 ~
                if num == 27 and next_b == 59 then
                    local key = 0
                    next_b = read_byte()
                    while next_b and next_b >= 48 and next_b <= 57 do
                        key = key * 10 + (next_b - 48)
                        next_b = read_byte()
                    end
                    if key == 13 and next_b == 126 then
                        return "newline"  -- Shift+Enter via modifyOtherKeys
                    end
                end
            end

            if next_b == 126 then -- '~'
                if num == 1 then return "home" end
                if num == 3 then return "delete" end
                if num == 4 then return "end" end
                if num == 200 then return "paste_start" end
            end

            -- CSI u without modifier: ESC [ keycode u
            if next_b == 117 then -- 'u'
                if num == 13 then return "enter" end
                if num == 99 then return "ctrl_c" end   -- shouldn't happen without modifier but just in case
                if num == 100 then return "ctrl_d" end
            end
        end
    end

    debug_log("escape sequence: unrecognized")
    return "escape"
end

-- ANSI helpers
local function clear_to_end()
    io.write("\27[K")
end

-- Calculate visual width of string (strips ANSI escape sequences)
local function visual_width(str)
    -- Remove ANSI escape sequences: ESC [ ... m (and other CSI sequences)
    local stripped = str:gsub("\27%[[%d;]*[A-Za-z]", "")
    return #stripped
end

local function move_cursor_up(n)
    if n > 0 then io.write(string.format("\27[%dA", n)) end
end

local function move_cursor_down(n)
    if n > 0 then io.write(string.format("\27[%dB", n)) end
end

local function move_cursor_forward(n)
    if n > 0 then io.write(string.format("\27[%dC", n)) end
end

local function move_cursor_back(n)
    if n > 0 then io.write(string.format("\27[%dD", n)) end
end

-- Buffer helper: convert flat position to line,col
local function pos_to_line_col(buf, pos)
    local line = 1
    local col = 0
    for i = 1, pos do
        if buf:sub(i, i) == "\n" then
            line = line + 1
            col = 0
        else
            col = col + 1
        end
    end
    return line, col
end

-- Get line count in buffer
local function count_lines(buf)
    local count = 1
    for _ in buf:gmatch("\n") do
        count = count + 1
    end
    return count
end

-- Get the content of a specific line (1-indexed)
local function get_line(buf, line_num)
    local current = 1
    local start_pos = 1
    for i = 1, #buf do
        if current == line_num then
            local end_pos = buf:find("\n", i)
            if end_pos then
                return buf:sub(i, end_pos - 1)
            else
                return buf:sub(i)
            end
        end
        if buf:sub(i, i) == "\n" then
            current = current + 1
            start_pos = i + 1
        end
    end
    if current == line_num then
        return buf:sub(start_pos)
    end
    return ""
end

-- Word-wrap a single line of text (with prompt) into multiple display lines
-- Returns array of {text, is_first, prompt, start_idx, end_idx} for each display line
-- start_idx and end_idx are 1-indexed positions in content (inclusive)
local function word_wrap_line(prompt_text, content, term_width)
    local prompt_len = visual_width(prompt_text)
    local first_line_width = term_width - prompt_len
    local continuation_width = term_width

    -- Handle empty content
    if #content == 0 then
        return {{
            text = "",
            is_first = true,
            prompt = prompt_text,
            start_idx = 1,
            end_idx = 0  -- empty range
        }}
    end

    local display_lines = {}
    local start_idx = 1
    local is_first = true

    while start_idx <= #content do
        local available = is_first and first_line_width or continuation_width
        local remaining_len = #content - start_idx + 1

        if remaining_len <= available then
            -- Rest fits on this line
            table.insert(display_lines, {
                text = content:sub(start_idx),
                is_first = is_first,
                prompt = is_first and prompt_text or "",
                start_idx = start_idx,
                end_idx = #content
            })
            break
        end

        -- Need to wrap - find last space within available width
        local search_end = start_idx + available - 1
        local break_idx = nil

        for i = search_end, start_idx, -1 do
            if content:sub(i, i) == " " then
                break_idx = i
                break
            end
        end

        if break_idx then
            -- Break at space: display chars up to (not including) space
            table.insert(display_lines, {
                text = content:sub(start_idx, break_idx - 1),
                is_first = is_first,
                prompt = is_first and prompt_text or "",
                start_idx = start_idx,
                end_idx = break_idx  -- include the space in the range for cursor calc
            })
            start_idx = break_idx + 1  -- skip past the space
        else
            -- No space found, hard break at width
            table.insert(display_lines, {
                text = content:sub(start_idx, search_end),
                is_first = is_first,
                prompt = is_first and prompt_text or "",
                start_idx = start_idx,
                end_idx = search_end
            })
            start_idx = search_end + 1
        end

        is_first = false
    end

    return display_lines
end

-- Get all display lines for the entire buffer
local function get_all_display_lines(prompt, continue_prompt, buf, term_width)
    local all_lines = {}
    local num_lines = count_lines(buf)

    for i = 1, num_lines do
        local line_content = get_line(buf, i)
        local p = (i == 1) and prompt or string.format(continue_prompt, i)
        local wrapped = word_wrap_line(p, line_content, term_width)
        for _, dl in ipairs(wrapped) do
            dl.logical_line = i
            table.insert(all_lines, dl)
        end
    end

    return all_lines
end

-- Calculate cursor position in display coordinates
-- Returns: display_row (0-indexed), column within that row
local function calc_cursor_display_pos(prompt, continue_prompt, buf, pos, term_width)
    local cur_line, cur_col = pos_to_line_col(buf, pos)
    local display_row = 0

    -- Count display rows for lines before cursor's logical line
    for i = 1, cur_line - 1 do
        local line_content = get_line(buf, i)
        local p = (i == 1) and prompt or string.format(continue_prompt, i)
        local wrapped = word_wrap_line(p, line_content, term_width)
        display_row = display_row + #wrapped
    end

    -- Now find position within current logical line
    local cur_line_content = get_line(buf, cur_line)
    local cur_prompt = (cur_line == 1) and prompt or string.format(continue_prompt, cur_line)
    local prompt_len = visual_width(cur_prompt)

    -- Walk through wrapped lines to find where cursor lands
    -- cur_col is 0-indexed, convert to 1-indexed for comparison with start_idx/end_idx
    local cursor_idx = cur_col + 1
    local wrapped = word_wrap_line(cur_prompt, cur_line_content, term_width)

    for idx, dl in ipairs(wrapped) do
        -- Check if cursor falls within this display line's character range
        local is_last_line = (idx == #wrapped)
        local in_range

        if is_last_line then
            -- Last display line: cursor can be at end (end_idx + 1)
            in_range = cursor_idx >= dl.start_idx and cursor_idx <= dl.end_idx + 1
        else
            -- Not last line: cursor at end_idx goes to next line (the space is consumed)
            in_range = cursor_idx >= dl.start_idx and cursor_idx <= dl.end_idx
        end

        if in_range then
            local col_in_text = cursor_idx - dl.start_idx
            -- Clamp to displayed text length
            col_in_text = math.min(col_in_text, #dl.text)
            if dl.is_first then
                return display_row, prompt_len + col_in_text
            else
                return display_row, col_in_text
            end
        end
        display_row = display_row + 1
    end

    -- Cursor at very end - put it at end of last display line
    local last = wrapped[#wrapped]
    if last.is_first then
        return display_row - 1, prompt_len + #last.text
    else
        return display_row - 1, #last.text
    end
end

-- Refresh display in blind mode (minimal feedback)
local function refresh_display_blind(prompt, buf, old_row_count)
    -- Move to start and clear
    if old_row_count > 1 then
        move_cursor_up(old_row_count - 1)
    end
    io.write("\r")
    clear_to_end()

    -- Show prompt with subtle indicator
    local char_count = #buf
    local indicator = ""

    if char_count == 0 then
        indicator = "\27[2m···\27[0m"  -- dim dots when empty
    else
        -- Breathing indicator: cycles through dots based on char count
        local idx = (char_count % #blind_indicator_chars) + 1
        local dots = ""
        for i = 1, math.min(3, math.ceil(char_count / 10)) do
            dots = dots .. blind_indicator_chars[((char_count + i) % #blind_indicator_chars) + 1]
        end
        indicator = "\27[2m" .. dots .. "\27[0m"  -- dim
    end

    io.write(prompt .. indicator)
    io.flush()
    return 1, 0
end

-- Refresh multiline display with word wrapping
-- Returns: total_rows, cursor_row (both needed for next refresh)
local function refresh_display(prompt, continue_prompt, buf, pos, old_row_count, old_cursor_row)
    -- Blind mode: show minimal feedback instead of actual text
    if BLIND_MODE then
        return refresh_display_blind(prompt, buf, old_row_count)
    end

    old_cursor_row = old_cursor_row or (old_row_count - 1)  -- default: assume cursor at last row
    local term_width = get_term_width()
    local display_lines = get_all_display_lines(prompt, continue_prompt, buf, term_width)
    local total_rows = #display_lines
    local cursor_row, cursor_col = calc_cursor_display_pos(prompt, continue_prompt, buf, pos, term_width)

    debug_log(string.format("refresh_display: old_rows=%d old_cursor_row=%d new_rows=%d cursor_row=%d cursor_col=%d pos=%d buf_len=%d",
        old_row_count, old_cursor_row, total_rows, cursor_row, cursor_col, pos, #buf))
    for i, dl in ipairs(display_lines) do
        debug_log(string.format("  line %d: prompt=%q text=%q", i, dl.prompt, dl.text))
    end

    -- Move cursor to beginning of input area (row 0)
    -- Use old_cursor_row to know where cursor actually is, not old_row_count
    if old_cursor_row > 0 then
        move_cursor_up(old_cursor_row)
    end
    io.write("\r")

    -- Clear all old rows
    for i = 1, old_row_count do
        clear_to_end()
        if i < old_row_count then
            io.write("\n")
        end
    end

    -- Move back to start
    if old_row_count > 1 then
        move_cursor_up(old_row_count - 1)
    end
    io.write("\r")

    -- Draw each display line
    for i, dl in ipairs(display_lines) do
        io.write(dl.prompt .. dl.text)
        clear_to_end()
        if i < total_rows then
            io.write("\n")
        end
    end

    -- Position cursor correctly
    local rows_from_end = total_rows - cursor_row - 1
    if rows_from_end > 0 then
        move_cursor_up(rows_from_end)
    end
    io.write("\r")
    if cursor_col > 0 then
        move_cursor_forward(cursor_col)
    end

    io.flush()
    return total_rows, cursor_row
end

-- Main readline function
function M.readline(prompt, continue_prompt)
    prompt = prompt or ""
    continue_prompt = continue_prompt or "... "

    io.write(prompt)
    io.flush()

    enable_raw_mode()

    local buf = ""
    local pos = 0
    local history_index = #history + 1
    local saved_line = ""
    local displayed_rows = 1
    local cursor_row = 0  -- track which display row the cursor is on (0-indexed)

    while true do
        local b = read_byte()
        if not b then
            disable_raw_mode()
            return nil
        end

        -- Enter (submit or continue if line ends with \)
        if b == 13 then
            -- Check for trailing backslash (line continuation)
            if pos > 0 and buf:sub(pos, pos) == "\\" then
                -- Remove backslash first and refresh to hide it
                buf = buf:sub(1, pos - 1) .. buf:sub(pos + 1)
                pos = pos - 1
                displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)
                -- Now insert newline
                buf = buf:sub(1, pos) .. "\n" .. buf:sub(pos + 1)
                pos = pos + 1
                displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)
            else
                -- Normal submit
                -- Move to end of display
                local total_lines = count_lines(buf)
                local cur_line = pos_to_line_col(buf, pos)
                if cur_line < total_lines then
                    move_cursor_down(total_lines - cur_line)
                end
                io.write("\n")
                disable_raw_mode()

                if buf ~= "" and (history[#history] ~= buf) then
                    table.insert(history, buf)
                    if #history > max_history then
                        table.remove(history, 1)
                    end
                end

                return buf
            end

        -- LF (byte 10) - in kitty protocol this is plain Enter, treat same as CR
        elseif b == 10 then
            -- Check for trailing backslash (line continuation)
            if pos > 0 and buf:sub(pos, pos) == "\\" then
                -- Remove backslash first and refresh to hide it
                buf = buf:sub(1, pos - 1) .. buf:sub(pos + 1)
                pos = pos - 1
                displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)
                -- Now insert newline
                buf = buf:sub(1, pos) .. "\n" .. buf:sub(pos + 1)
                pos = pos + 1
                displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)
            else
                -- Normal submit
                local total_lines = count_lines(buf)
                local cur_line = pos_to_line_col(buf, pos)
                if cur_line < total_lines then
                    move_cursor_down(total_lines - cur_line)
                end
                io.write("\n")
                disable_raw_mode()

                if buf ~= "" and (history[#history] ~= buf) then
                    table.insert(history, buf)
                    if #history > max_history then
                        table.remove(history, 1)
                    end
                end

                return buf
            end

        -- Ctrl+C
        elseif b == 3 then
            io.write("^C\n")
            disable_raw_mode()
            return nil

        -- Ctrl+D
        elseif b == 4 then
            if buf == "" then
                io.write("\n")
                disable_raw_mode()
                return nil
            end

        -- Ctrl+A (Home - start of current line)
        elseif b == 1 then
            -- Find start of current line
            while pos > 0 and buf:sub(pos, pos) ~= "\n" do
                pos = pos - 1
            end
            displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)

        -- Ctrl+E (End - end of current line)
        elseif b == 5 then
            -- Find end of current line
            while pos < #buf and buf:sub(pos + 1, pos + 1) ~= "\n" do
                pos = pos + 1
            end
            displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)

        -- Ctrl+K (Kill to end of line)
        elseif b == 11 then
            local end_pos = buf:find("\n", pos + 1) or (#buf + 1)
            buf = buf:sub(1, pos) .. buf:sub(end_pos)
            displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)

        -- Ctrl+U (Kill to start of line)
        elseif b == 21 then
            local start_pos = pos
            while start_pos > 0 and buf:sub(start_pos, start_pos) ~= "\n" do
                start_pos = start_pos - 1
            end
            buf = buf:sub(1, start_pos) .. buf:sub(pos + 1)
            pos = start_pos
            displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)

        -- Ctrl+W (Kill word backward)
        elseif b == 23 then
            local new_pos = pos
            -- Skip spaces
            while new_pos > 0 and buf:sub(new_pos, new_pos):match("%s") do
                new_pos = new_pos - 1
            end
            -- Skip word
            while new_pos > 0 and not buf:sub(new_pos, new_pos):match("%s") do
                new_pos = new_pos - 1
            end
            buf = buf:sub(1, new_pos) .. buf:sub(pos + 1)
            pos = new_pos
            displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)

        -- Ctrl+L (Clear screen)
        elseif b == 12 then
            io.write("\27[2J\27[H")
            displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, 1, 0)

        -- Backspace
        elseif b == 127 or b == 8 then
            if pos > 0 then
                buf = buf:sub(1, pos - 1) .. buf:sub(pos + 1)
                pos = pos - 1
                displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)
            end

        -- Escape sequence
        elseif b == 27 then
            local key = read_escape_sequence()

            if key == "newline" then
                buf = buf:sub(1, pos) .. "\n" .. buf:sub(pos + 1)
                pos = pos + 1
                displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)

            elseif key == "left" then
                if pos > 0 then
                    pos = pos - 1
                    displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)
                end

            elseif key == "right" then
                if pos < #buf then
                    pos = pos + 1
                    displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)
                end

            elseif key == "up" then
                local cur_line, cur_col = pos_to_line_col(buf, pos)
                debug_log(string.format("UP: cur_line=%d cur_col=%d pos=%d", cur_line, cur_col, pos))
                if cur_line > 1 then
                    -- Move to previous line in buffer
                    local prev_line = get_line(buf, cur_line - 1)
                    local new_col = math.min(cur_col, #prev_line)
                    debug_log(string.format("UP: moving within buffer, prev_line=%q new_col=%d", prev_line, new_col))
                    -- Calculate new position
                    local new_pos = 0
                    local line = 1
                    for i = 1, #buf do
                        if line == cur_line - 1 then
                            new_pos = new_pos + new_col
                            break
                        end
                        if buf:sub(i, i) == "\n" then
                            line = line + 1
                        end
                        new_pos = new_pos + 1
                    end
                    pos = new_pos
                    displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)
                else
                    -- History navigation
                    if history_index > 1 then
                        if history_index == #history + 1 then
                            saved_line = buf
                        end
                        history_index = history_index - 1
                        buf = history[history_index]
                        pos = #buf
                        displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)
                    end
                end

            elseif key == "down" then
                local cur_line, cur_col = pos_to_line_col(buf, pos)
                local total_lines = count_lines(buf)
                if cur_line < total_lines then
                    -- Move to next line in buffer
                    local next_line = get_line(buf, cur_line + 1)
                    local new_col = math.min(cur_col, #next_line)
                    -- Calculate new position
                    local new_pos = 0
                    local line = 1
                    for i = 1, #buf do
                        if buf:sub(i, i) == "\n" then
                            line = line + 1
                            if line == cur_line + 1 then
                                new_pos = i + new_col
                                break
                            end
                        end
                        new_pos = new_pos + 1
                    end
                    pos = math.min(new_pos, #buf)
                    displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)
                else
                    -- History navigation
                    if history_index <= #history then
                        history_index = history_index + 1
                        if history_index > #history then
                            buf = saved_line
                        else
                            buf = history[history_index]
                        end
                        pos = #buf
                        displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)
                    end
                end

            elseif key == "home" then
                pos = 0
                displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)

            elseif key == "end" then
                pos = #buf
                displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)

            elseif key == "delete" then
                if pos < #buf then
                    buf = buf:sub(1, pos) .. buf:sub(pos + 2)
                    displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)
                end

            elseif key == "paste_start" then
                local pasted = read_bracketed_paste()
                if pasted and pasted ~= "" then
                    buf = buf:sub(1, pos) .. pasted .. buf:sub(pos + 1)
                    pos = pos + #pasted
                    displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)
                end

            elseif key == "ctrl_c" then
                io.write("^C\n")
                disable_raw_mode()
                return nil

            elseif key == "ctrl_d" then
                if buf == "" then
                    io.write("\n")
                    disable_raw_mode()
                    return nil
                end

            elseif key == "enter" then
                -- Plain Enter via kitty protocol - same as byte 13
                if pos > 0 and buf:sub(pos, pos) == "\\" then
                    -- Remove backslash first and refresh to hide it
                    buf = buf:sub(1, pos - 1) .. buf:sub(pos + 1)
                    pos = pos - 1
                    displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)
                    -- Now insert newline
                    buf = buf:sub(1, pos) .. "\n" .. buf:sub(pos + 1)
                    pos = pos + 1
                    displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)
                else
                    local total_lines = count_lines(buf)
                    local cur_line = pos_to_line_col(buf, pos)
                    if cur_line < total_lines then
                        move_cursor_down(total_lines - cur_line)
                    end
                    io.write("\n")
                    disable_raw_mode()

                    if buf ~= "" and (history[#history] ~= buf) then
                        table.insert(history, buf)
                        if #history > max_history then
                            table.remove(history, 1)
                        end
                    end

                    return buf
                end
            end

        -- Regular printable character
        elseif b >= 32 and b < 127 then
            local char = string.char(b)
            buf = buf:sub(1, pos) .. char .. buf:sub(pos + 1)
            pos = pos + 1
            displayed_rows, cursor_row = refresh_display(prompt, continue_prompt, buf, pos, displayed_rows, cursor_row)
        end
    end
end

-- Get/set history
function M.get_history()
    return history
end

function M.set_history(h)
    history = h or {}
end

function M.clear_history()
    history = {}
end

-- Blind mode: typing hidden from user (like speaking)
function M.set_blind_mode(enabled)
    BLIND_MODE = enabled
    blind_char_count = 0
end

function M.get_blind_mode()
    return BLIND_MODE
end

return M
