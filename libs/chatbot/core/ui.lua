-- ui.lua - Display and user interaction with smart output formatting

local rl = require("readline")

local UI = {}
UI.__index = UI

-- ANSI color codes
UI.colors = {
    reset  = "\27[0m",
    cyan   = "\27[36m",
    yellow = "\27[33m",
    green  = "\27[32m",
    blue   = "\27[34m",
    red    = "\27[31m",
    dim    = "\27[2m",
}

--------------------------------------------------------------------------------
-- Stream Formatter - real-time word wrapping and table buffering
--------------------------------------------------------------------------------

local StreamFormatter = {}
StreamFormatter.__index = StreamFormatter

-- ANSI codes for markdown rendering
local md_codes = {
    bold = "\27[1m",           -- Bold
    italic = "\27[3m",         -- Italic
    underline = "\27[4m",      -- Underline
    strikethrough = "\27[9m",  -- Strikethrough
    code = "\27[33m",          -- Yellow for inline code
    code_block = "\27[38;5;223m", -- Warm light color for code blocks
    header1 = "\27[1;4;36m",   -- Bold underline cyan for h1
    header2 = "\27[1;36m",     -- Bold cyan for h2
    header3 = "\27[36m",       -- Cyan for h3+
    bullet = "\27[36m",        -- Cyan for bullet points
    blockquote = "\27[2;3m",   -- Dim italic for blockquotes
    hr = "\27[2m",             -- Dim for horizontal rules
    link = "\27[4;34m",        -- Underline blue for links
    reset = "\27[0m",
    -- Syntax highlighting colors
    syntax = {
        keyword = "\27[38;5;204m",   -- Pink/red for keywords
        string = "\27[38;5;143m",    -- Olive/green for strings
        comment = "\27[38;5;102m",   -- Gray for comments
        number = "\27[38;5;175m",    -- Light purple for numbers
        func = "\27[38;5;81m",       -- Light blue for function names
        type = "\27[38;5;221m",      -- Gold for types
    },
}

-- Common emoji shortcodes
local emoji_map = {
    [":smile:"] = "😊", [":grin:"] = "😁", [":joy:"] = "😂", [":heart:"] = "❤️",
    [":thumbsup:"] = "👍", [":thumbsdown:"] = "👎", [":fire:"] = "🔥", [":star:"] = "⭐",
    [":check:"] = "✓", [":x:"] = "✗", [":warning:"] = "⚠️", [":info:"] = "ℹ️",
    [":rocket:"] = "🚀", [":sparkles:"] = "✨", [":tada:"] = "🎉", [":thinking:"] = "🤔",
    [":+1:"] = "👍", [":-1:"] = "👎", [":ok:"] = "👌", [":wave:"] = "👋",
    [":eyes:"] = "👀", [":pray:"] = "🙏", [":clap:"] = "👏", [":muscle:"] = "💪",
}

-- Syntax highlighting patterns for different languages
local syntax_patterns = {
    lua = {
        keywords = {
            "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
            "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return",
            "then", "true", "until", "while"
        },
        types = {"string", "number", "table", "boolean", "thread", "userdata"},
        comment = "%-%-",
        multiline_comment_start = "%-%-%[%[",
        multiline_comment_end = "%]%]",
        string_delims = {'"', "'", "%[%["},
    },
    c = {
        keywords = {
            "auto", "break", "case", "char", "const", "continue", "default", "do",
            "double", "else", "enum", "extern", "float", "for", "goto", "if",
            "inline", "int", "long", "register", "restrict", "return", "short",
            "signed", "sizeof", "static", "struct", "switch", "typedef", "union",
            "unsigned", "void", "volatile", "while", "#include", "#define", "#ifdef",
            "#ifndef", "#endif", "#else", "#elif", "#pragma", "NULL", "true", "false"
        },
        types = {"int", "char", "float", "double", "void", "long", "short", "unsigned", "signed", "bool", "size_t"},
        comment = "//",
        multiline_comment_start = "/%*",
        multiline_comment_end = "%*/",
        string_delims = {'"', "'"},
    },
    bash = {
        keywords = {
            "if", "then", "else", "elif", "fi", "case", "esac", "for", "while", "until",
            "do", "done", "in", "function", "return", "exit", "break", "continue",
            "export", "local", "readonly", "declare", "typeset", "source", "alias",
            "unalias", "set", "unset", "shift", "trap", "eval", "exec", "true", "false"
        },
        types = {},
        comment = "#",
        string_delims = {'"', "'", "`"},
    },
}
-- Also recognize common aliases
syntax_patterns.sh = syntax_patterns.bash
syntax_patterns.shell = syntax_patterns.bash
syntax_patterns.zsh = syntax_patterns.bash
syntax_patterns.cpp = syntax_patterns.c
syntax_patterns["c++"] = syntax_patterns.c
syntax_patterns.h = syntax_patterns.c

function StreamFormatter.new(config)
    local self = setmetatable({}, StreamFormatter)
    self.line_width = config.output_line_width or 100
    self.format_tables = config.format_tables ~= false

    -- State for streaming
    self.col = 0                -- Current column position
    self.word_start_col = 0     -- Column where current word started (after last space before word)
    self.current_word = ""      -- Current word being built
    self.line_buffer = ""       -- Current line being built (for table detection)
    self.in_table = false       -- Are we inside a table?
    self.table_lines = {}       -- Buffered table lines
    self.line_start = true      -- Are we at the start of a line?
    self.pending_output = ""    -- Buffered output at line start (until we know if table)

    -- Markdown state
    self.md = {
        bold = false,           -- Inside **...**
        italic = false,         -- Inside *...*
        code = false,           -- Inside `...`
        strikethrough = false,  -- Inside ~~...~~
        header_level = 0,       -- 1-6 for headers, 0 for none
        blockquote = false,     -- Line starts with >
        in_code_block = false,  -- Inside ```...```
        code_block_lang = nil,  -- Language for syntax highlighting
        code_block_lines = {},  -- Buffered code block content
    }

    -- Paragraph buffering (to join lines that the LLM splits)
    self.paragraph_buffer = ""

    return self
end

-- Reset state for new response
function StreamFormatter:reset()
    self.col = 0
    self.word_start_col = 0
    self.current_word = ""
    self.line_buffer = ""
    self.in_table = false
    self.table_lines = {}
    self.line_start = true
    self.pending_output = ""
    -- Reset markdown state
    self.md = {
        bold = false,
        italic = false,
        code = false,
        strikethrough = false,
        header_level = 0,
        blockquote = false,
        in_code_block = false,
        code_block_lang = nil,
        code_block_lines = {},
    }
    -- Reset paragraph buffer
    self.paragraph_buffer = ""
end

-- Get current formatting codes based on active markdown state
function StreamFormatter:get_active_format_codes()
    local codes = ""
    if self.md.header_level > 0 then
        if self.md.header_level == 1 then codes = codes .. md_codes.header1
        elseif self.md.header_level == 2 then codes = codes .. md_codes.header2
        else codes = codes .. md_codes.header3 end
    end
    if self.md.blockquote then codes = codes .. md_codes.blockquote end
    if self.md.bold then codes = codes .. md_codes.bold end
    if self.md.italic then codes = codes .. md_codes.italic end
    if self.md.strikethrough then codes = codes .. md_codes.strikethrough end
    if self.md.code then codes = codes .. md_codes.code end
    return codes
end

-- Apply syntax highlighting to a line of code
function StreamFormatter:highlight_code_line(line, lang)
    local patterns = syntax_patterns[lang]
    if not patterns then
        return md_codes.code_block .. line .. md_codes.reset
    end

    -- Check for comment first (comments override everything)
    if patterns.comment then
        local comment_start = line:find(patterns.comment)
        if comment_start then
            local before = line:sub(1, comment_start - 1)
            local comment = line:sub(comment_start)
            return self:highlight_code_line(before, lang) .. md_codes.syntax.comment .. comment .. md_codes.reset
        end
    end

    local result = md_codes.code_block
    local i = 1
    local len = #line

    while i <= len do
        local char = line:sub(i, i)

        -- Check for strings
        local in_string = false
        for _, delim in ipairs(patterns.string_delims or {}) do
            if line:sub(i, i + #delim - 1) == delim or line:sub(i, i) == delim:sub(1,1) then
                local actual_delim = #delim > 1 and line:sub(i, i + #delim - 1) or delim
                if line:sub(i, i + #actual_delim - 1) == actual_delim then
                    -- Find end of string
                    local end_pos = line:find(actual_delim, i + #actual_delim, true)
                    if end_pos then
                        result = result .. md_codes.syntax.string .. line:sub(i, end_pos + #actual_delim - 1) .. md_codes.code_block
                        i = end_pos + #actual_delim
                        in_string = true
                        break
                    end
                end
            end
        end
        if in_string then
            -- Continue to next iteration
        elseif char:match("[%a_]") then
            -- Could be a keyword or identifier
            local word_end = i
            while word_end <= len and line:sub(word_end, word_end):match("[%w_]") do
                word_end = word_end + 1
            end
            local word = line:sub(i, word_end - 1)

            -- Check if it's a keyword
            local is_keyword = false
            for _, kw in ipairs(patterns.keywords or {}) do
                if word == kw then
                    is_keyword = true
                    break
                end
            end

            -- Check if it's a type
            local is_type = false
            if not is_keyword then
                for _, t in ipairs(patterns.types or {}) do
                    if word == t then
                        is_type = true
                        break
                    end
                end
            end

            -- Check if followed by ( - likely a function call
            local is_func = not is_keyword and not is_type and line:sub(word_end, word_end) == "("

            if is_keyword then
                result = result .. md_codes.syntax.keyword .. word .. md_codes.code_block
            elseif is_type then
                result = result .. md_codes.syntax.type .. word .. md_codes.code_block
            elseif is_func then
                result = result .. md_codes.syntax.func .. word .. md_codes.code_block
            else
                result = result .. word
            end
            i = word_end
        elseif char:match("[0-9]") then
            -- Number
            local num_end = i
            while num_end <= len and line:sub(num_end, num_end):match("[0-9%.xXa-fA-F]") do
                num_end = num_end + 1
            end
            result = result .. md_codes.syntax.number .. line:sub(i, num_end - 1) .. md_codes.code_block
            i = num_end
        else
            result = result .. char
            i = i + 1
        end
    end

    return result .. md_codes.reset
end

-- Escape placeholders - using private use area characters to avoid conflicts
local ESCAPE_PLACEHOLDER = {
    ["*"] = "\u{E001}",  -- Escaped asterisk
    ["`"] = "\u{E002}",  -- Escaped backtick
    ["~"] = "\u{E003}",  -- Escaped tilde
    ["#"] = "\u{E004}",  -- Escaped hash
    ["\\"] = "\u{E005}", -- Escaped backslash
    ["["] = "\u{E006}",  -- Escaped bracket
    ["]"] = "\u{E007}",  -- Escaped bracket
    [">"] = "\u{E008}",  -- Escaped greater-than
    ["_"] = "\u{E009}",  -- Escaped underscore
}

-- Convert placeholders back to actual characters
local function restore_escaped_chars(text)
    text = text:gsub("\u{E001}", "*")
    text = text:gsub("\u{E002}", "`")
    text = text:gsub("\u{E003}", "~")
    text = text:gsub("\u{E004}", "#")
    text = text:gsub("\u{E005}", "\\")
    text = text:gsub("\u{E006}", "[")
    text = text:gsub("\u{E007}", "]")
    text = text:gsub("\u{E008}", ">")
    text = text:gsub("\u{E009}", "_")
    return text
end

-- Render markdown in text, returning the rendered string
-- Updates self.md state for patterns that span multiple calls
function StreamFormatter:render_markdown(text)
    if not text or text == "" then return "" end

    local result = ""
    local i = 1
    local len = #text

    while i <= len do
        local char = text:sub(i, i)
        local next_char = text:sub(i + 1, i + 1)
        local next_two = text:sub(i + 1, i + 2)

        -- Check for escape sequences (backslash)
        if char == "\\" and next_char ~= "" then
            -- Use placeholder for escaped character so it won't be processed as markdown
            local placeholder = ESCAPE_PLACEHOLDER[next_char]
            if placeholder then
                result = result .. placeholder
            else
                -- Unknown escape, just output the character
                result = result .. next_char
            end
            i = i + 2

        -- Check for ~~ (strikethrough)
        elseif char == "~" and next_char == "~" then
            if self.md.strikethrough then
                result = result .. md_codes.reset .. self:get_active_format_codes()
                self.md.strikethrough = false
            else
                self.md.strikethrough = true
                result = result .. md_codes.strikethrough
            end
            i = i + 2

        -- Check for ** (bold)
        elseif char == "*" and next_char == "*" then
            if self.md.bold then
                self.md.bold = false
                result = result .. md_codes.reset .. self:get_active_format_codes()
            else
                self.md.bold = true
                result = result .. md_codes.bold
            end
            i = i + 2

        -- Check for single * (italic) - but not if part of **
        elseif char == "*" and next_char ~= "*" then
            local prev_char = i > 1 and text:sub(i - 1, i - 1) or ""
            if prev_char ~= "*" then
                if self.md.italic then
                    self.md.italic = false
                    result = result .. md_codes.reset .. self:get_active_format_codes()
                else
                    self.md.italic = true
                    result = result .. md_codes.italic
                end
            else
                result = result .. char
            end
            i = i + 1

        -- Check for ` (inline code) - but not ```
        elseif char == "`" and next_two ~= "``" then
            if self.md.code then
                -- End code - restore previous formatting
                self.md.code = false
                result = result .. md_codes.reset .. self:get_active_format_codes()
            else
                -- Start code - reset all other inline formatting first, then apply code style
                -- Code blocks don't have bold/italic/strikethrough inside them
                result = result .. md_codes.reset .. md_codes.code
                self.md.code = true
            end
            i = i + 1

        -- Check for emoji shortcodes :name:
        elseif char == ":" then
            local emoji_end = text:find(":", i + 1)
            if emoji_end and emoji_end - i < 20 then
                local shortcode = text:sub(i, emoji_end)
                local emoji = emoji_map[shortcode]
                if emoji then
                    result = result .. emoji
                    i = emoji_end + 1
                else
                    result = result .. char
                    i = i + 1
                end
            else
                result = result .. char
                i = i + 1
            end

        else
            result = result .. char
            i = i + 1
        end
    end

    -- Restore escaped characters (convert placeholders back to actual characters)
    return restore_escaped_chars(result)
end

-- End any active markdown formatting (call at end of line or stream)
function StreamFormatter:end_markdown_line()
    local result = ""
    if self.md.bold or self.md.italic or self.md.code or self.md.strikethrough or
       self.md.header_level > 0 or self.md.blockquote then
        result = md_codes.reset
    end
    -- Reset line-specific state
    self.md.header_level = 0
    self.md.blockquote = false
    -- Reset inline formatting at newlines for cleaner output
    self.md.bold = false
    self.md.italic = false
    self.md.code = false
    self.md.strikethrough = false
    return result
end

-- Calculate display width of a string (handles UTF-8 and emoji)
-- This attempts to match terminal display width for common characters
local function display_width(str)
    local width = 0
    local i = 1
    local len = #str
    local prev_was_regional = false  -- for flag emoji detection

    while i <= len do
        local byte = str:byte(i)

        if byte < 128 then
            -- ASCII: 1 byte, 1 width
            width = width + 1
            i = i + 1
            prev_was_regional = false

        elseif byte < 224 then
            -- 2-byte UTF-8 (U+0080-U+07FF): 1 width
            width = width + 1
            i = i + 2
            prev_was_regional = false

        elseif byte < 240 then
            -- 3-byte UTF-8 (U+0800-U+FFFF)
            -- Decode codepoint to check for special ranges
            local b2 = str:byte(i + 1) or 0
            local b3 = str:byte(i + 2) or 0
            local codepoint = ((byte - 224) * 4096) + ((b2 - 128) * 64) + (b3 - 128)

            if codepoint >= 0xFE00 and codepoint <= 0xFE0F then
                -- Variation selectors: 0 width (they modify previous char)
                -- Don't add width
            elseif codepoint == 0x200D then
                -- Zero-width joiner: 0 width
                -- Don't add width
            elseif (codepoint >= 0x0300 and codepoint <= 0x036F) then
                -- Combining Diacritical Marks: 0 width
                -- Don't add width
            elseif (codepoint >= 0x093A and codepoint <= 0x094F) or
                   (codepoint >= 0x0951 and codepoint <= 0x0957) or
                   (codepoint >= 0x0962 and codepoint <= 0x0963) then
                -- Devanagari combining marks (matras, nukta, virama): 0 width
                -- Don't add width
            elseif (codepoint >= 0x09BE and codepoint <= 0x09CD) or
                   (codepoint >= 0x09E2 and codepoint <= 0x09E3) then
                -- Bengali combining marks: 0 width
                -- Don't add width
            elseif (codepoint >= 0x0A3E and codepoint <= 0x0A4D) then
                -- Gurmukhi combining marks: 0 width
                -- Don't add width
            elseif (codepoint >= 0x0ABE and codepoint <= 0x0ACD) then
                -- Gujarati combining marks: 0 width
                -- Don't add width
            elseif (codepoint >= 0x0B3E and codepoint <= 0x0B4D) then
                -- Oriya combining marks: 0 width
                -- Don't add width
            elseif (codepoint >= 0x0BBE and codepoint <= 0x0BCD) then
                -- Tamil combining marks: 0 width
                -- Don't add width
            elseif (codepoint >= 0x0C3E and codepoint <= 0x0C4D) then
                -- Telugu combining marks: 0 width
                -- Don't add width
            elseif (codepoint >= 0x0CBE and codepoint <= 0x0CCD) then
                -- Kannada combining marks: 0 width
                -- Don't add width
            elseif (codepoint >= 0x0D3E and codepoint <= 0x0D4D) then
                -- Malayalam combining marks: 0 width
                -- Don't add width
            elseif (codepoint >= 0x0591 and codepoint <= 0x05BD) or
                   (codepoint >= 0x05BF and codepoint <= 0x05C7) then
                -- Hebrew combining marks: 0 width
                -- Don't add width
            elseif (codepoint >= 0x0610 and codepoint <= 0x061A) or
                   (codepoint >= 0x064B and codepoint <= 0x065F) then
                -- Arabic combining marks: 0 width
                -- Don't add width
            elseif codepoint >= 0x1100 and codepoint <= 0x11FF then
                -- Hangul Jamo: 2 wide
                width = width + 2
            elseif codepoint >= 0x2E80 and codepoint <= 0x9FFF then
                -- CJK ranges: 2 wide
                width = width + 2
            elseif codepoint >= 0xAC00 and codepoint <= 0xD7AF then
                -- Hangul syllables: 2 wide
                width = width + 2
            elseif codepoint >= 0xF900 and codepoint <= 0xFAFF then
                -- CJK Compatibility Ideographs: 2 wide
                width = width + 2
            elseif codepoint >= 0xFF00 and codepoint <= 0xFFEF then
                -- Fullwidth forms: 2 wide
                width = width + 2
            elseif codepoint >= 0x2600 and codepoint <= 0x26FF then
                -- Miscellaneous Symbols (many emoji): 2 wide
                width = width + 2
            elseif codepoint >= 0x2700 and codepoint <= 0x27BF then
                -- Dingbats (many emoji): 2 wide
                width = width + 2
            elseif codepoint >= 0x2300 and codepoint <= 0x23FF then
                -- Miscellaneous Technical (some emoji): 2 wide
                width = width + 2
            elseif codepoint >= 0x2B50 and codepoint <= 0x2B55 then
                -- Some emoji stars/circles: 2 wide
                width = width + 2
            else
                -- Other 3-byte chars (most symbols like ★☆): 1 wide
                width = width + 1
            end
            i = i + 3
            prev_was_regional = false

        else
            -- 4-byte UTF-8 (U+10000+): includes most emoji
            -- Decode to check for regional indicators (flag emoji)
            local b2 = str:byte(i + 1) or 0
            local b3 = str:byte(i + 2) or 0
            local b4 = str:byte(i + 3) or 0
            local codepoint = ((byte - 240) * 262144) + ((b2 - 128) * 4096) +
                              ((b3 - 128) * 64) + (b4 - 128)

            if codepoint >= 0x1F1E6 and codepoint <= 0x1F1FF then
                -- Regional indicator symbols (flag emoji components)
                -- Two of these combine to form one flag (2 wide total)
                if prev_was_regional then
                    -- Second regional indicator - don't add width (already counted)
                    prev_was_regional = false
                else
                    -- First regional indicator - add 2 for the pair
                    width = width + 2
                    prev_was_regional = true
                end
            else
                -- Most other 4-byte chars (emoji): 2 wide
                width = width + 2
                prev_was_regional = false
            end
            i = i + 4
        end
    end
    return width
end

-- Strip markdown syntax from text (for width calculation)
-- Returns the text as it would appear after rendering
local function strip_markdown_syntax(text)
    if not text or text == "" then return "" end

    -- First, protect escaped characters with placeholders
    text = text:gsub("\\%*", "\u{E001}")  -- \* → placeholder
    text = text:gsub("\\`", "\u{E002}")   -- \` → placeholder
    text = text:gsub("\\~", "\u{E003}")   -- \~ → placeholder
    text = text:gsub("\\#", "\u{E004}")   -- \# → placeholder
    text = text:gsub("\\\\", "\u{E005}")  -- \\ → placeholder
    text = text:gsub("\\%[", "\u{E006}")  -- \[ → placeholder
    text = text:gsub("\\%]", "\u{E007}")  -- \] → placeholder
    text = text:gsub("\\>", "\u{E008}")   -- \> → placeholder
    text = text:gsub("\\_", "\u{E009}")   -- \_ → placeholder

    -- Strip ~~ (strikethrough)
    text = text:gsub("~~", "")
    -- Strip ** (bold)
    text = text:gsub("%*%*", "")
    -- Strip single * (italic) - but be careful not to over-strip
    text = text:gsub("^%*", "")  -- Leading *
    text = text:gsub("%*$", "")  -- Trailing *
    text = text:gsub("(%s)%*", "%1")  -- * after space
    text = text:gsub("%*(%s)", "%1")  -- * before space
    -- Strip ` (inline code) but not ```
    text = text:gsub("```", "\0\0\0")  -- Temporarily protect code fences
    text = text:gsub("`", "")
    text = text:gsub("\0\0\0", "```")  -- Restore code fences
    -- Convert emoji shortcodes to emoji for proper width calculation
    for shortcode, emoji in pairs(emoji_map) do
        text = text:gsub(shortcode:gsub("([%(%)%.%%%+%-%*%?%[%]%^%$])", "%%%1"), emoji)
    end

    -- Restore escaped characters (they should appear in output)
    text = text:gsub("\u{E001}", "*")
    text = text:gsub("\u{E002}", "`")
    text = text:gsub("\u{E003}", "~")
    text = text:gsub("\u{E004}", "#")
    text = text:gsub("\u{E005}", "\\")
    text = text:gsub("\u{E006}", "[")
    text = text:gsub("\u{E007}", "]")
    text = text:gsub("\u{E008}", ">")
    text = text:gsub("\u{E009}", "_")

    return text
end

-- Calculate display width after markdown is stripped
local function display_width_rendered(text)
    return display_width(strip_markdown_syntax(text))
end

-- Word-wrap text and output with markdown rendering
-- continuation_prefix is used for lines after the first (e.g., indentation for bullets)
function StreamFormatter:wrap_and_output(text, prefix, prefix_width, continuation_prefix)
    prefix = prefix or ""
    prefix_width = prefix_width or 0
    -- Default: continuation uses same prefix (for blockquotes) or spaces (for indentation)
    if continuation_prefix == nil then
        continuation_prefix = prefix
    end

    -- Strip markdown for width calculation, but render for output
    local stripped = strip_markdown_syntax(text)
    local stripped_width = display_width(stripped)

    -- If it fits on one line, just output
    if prefix_width + stripped_width <= self.line_width then
        io.write(prefix .. self:render_markdown(text) .. self:end_markdown_line())
        return
    end

    -- Need to wrap - split into words
    local words = {}
    for word in text:gmatch("%S+") do
        table.insert(words, word)
    end

    local current_line = ""
    local current_width = prefix_width
    local first_line = true

    for _, word in ipairs(words) do
        local word_stripped = strip_markdown_syntax(word)
        local word_width = display_width(word_stripped)

        if current_line == "" then
            current_line = word
            current_width = prefix_width + word_width
        elseif current_width + 1 + word_width <= self.line_width then
            current_line = current_line .. " " .. word
            current_width = current_width + 1 + word_width
        else
            -- Output current line and start new one
            if first_line then
                io.write(prefix .. self:render_markdown(current_line) .. self:end_markdown_line() .. "\n")
                first_line = false
            else
                io.write(continuation_prefix .. self:render_markdown(current_line) .. self:end_markdown_line() .. "\n")
            end
            current_line = word
            current_width = prefix_width + word_width
        end
    end

    -- Output last line (without newline - caller adds it)
    if current_line ~= "" then
        if first_line then
            io.write(prefix .. self:render_markdown(current_line) .. self:end_markdown_line())
        else
            io.write(continuation_prefix .. self:render_markdown(current_line) .. self:end_markdown_line())
        end
    end
end

-- Output a complete line with markdown processing (for buffered lines)
function StreamFormatter:output_line_with_markdown(line)
    if not line or line == "" then return end

    -- Check for horizontal rule: --- or *** or ___ (3+ chars, alone on line)
    local hr_pattern = line:match("^%s*([%-]+)%s*$") or line:match("^%s*([%*]+)%s*$") or line:match("^%s*([_]+)%s*$")
    if hr_pattern and #hr_pattern >= 3 then
        io.write(md_codes.hr .. string.rep("─", math.min(self.line_width, 50)) .. md_codes.reset)
        return
    end

    -- Check for headers: # ## ### etc.
    local hashes, space, rest = line:match("^(#+)(%s*)(.*)")
    if hashes then
        local level = math.min(#hashes, 6)
        self.md.header_level = level
        local header_code
        if level == 1 then header_code = md_codes.header1
        elseif level == 2 then header_code = md_codes.header2
        else header_code = md_codes.header3 end
        -- Headers don't wrap - output as-is with formatting
        io.write(header_code .. self:render_markdown(rest) .. self:end_markdown_line())
        return
    end

    -- Check for blockquotes: > text
    local quote_marker, quote_space, quote_text = line:match("^(>)(%s*)(.*)")
    if quote_marker then
        self.md.blockquote = true
        local prefix = md_codes.blockquote .. "│ "
        -- Continuation lines also get the │ prefix
        self:wrap_and_output(quote_text, prefix, 2, prefix)
        self.md.blockquote = false
        return
    end

    -- Check for bullet points: - or * followed by space
    local bullet, bullet_space, bullet_text = line:match("^([%-])(%s+)(.*)")
    if not bullet then
        bullet, bullet_space, bullet_text = line:match("^([%*])(%s+)(.*)")
    end
    if bullet and bullet_space and #bullet_space >= 1 then
        local prefix = md_codes.bullet .. "•" .. md_codes.reset .. " "
        -- Continuation lines get spaces to align with bullet text
        self:wrap_and_output(bullet_text, prefix, 2, "  ")
        return
    end

    -- Check for numbered lists: 1. 2. etc.
    local num, num_space, num_text = line:match("^(%d+%.)(%s+)(.*)")
    if num then
        local prefix = md_codes.bullet .. num .. md_codes.reset .. " "
        local indent = string.rep(" ", #num + 1)
        -- Continuation lines get spaces to align with list text
        self:wrap_and_output(num_text, prefix, #num + 1, indent)
        return
    end

    -- Regular line - wrap and output with markdown
    self:wrap_and_output(line, "", 0)
end

-- Calculate table width from column widths
function StreamFormatter:calculate_table_width(widths, cell_padding)
    local total = 1 -- opening |
    for _, w in ipairs(widths) do
        total = total + w + (cell_padding * 2) + 1 -- content + padding + |
    end
    return total
end

-- Wrap text to a target width at word boundaries, returning array of lines
function StreamFormatter:wrap_text_to_width(text, target_width)
    if target_width < 5 then target_width = 5 end
    if display_width(text) <= target_width then
        return {text}
    end

    local lines = {}
    local words = {}
    for word in text:gmatch("%S+") do
        table.insert(words, word)
    end

    local current_line = ""
    local current_width = 0
    for _, word in ipairs(words) do
        local word_width = display_width(word)
        if current_line == "" then
            current_line = word
            current_width = word_width
        elseif current_width + 1 + word_width <= target_width then
            current_line = current_line .. " " .. word
            current_width = current_width + 1 + word_width
        else
            table.insert(lines, current_line)
            current_line = word
            current_width = word_width
        end
    end

    if current_line ~= "" then
        table.insert(lines, current_line)
    end

    return #lines > 0 and lines or {""}
end

-- Calculate target widths using "shrink largest first" strategy
-- This minimizes the number of columns that need wrapping
function StreamFormatter:calculate_target_widths(natural_widths, max_width, cell_padding, min_wrap_width)
    min_wrap_width = min_wrap_width or 18  -- Minimum width for wrapped columns
    local num_cols = #natural_widths

    -- Calculate available content space
    local overhead = 1 + (num_cols * (cell_padding * 2 + 1))
    local available = max_width - overhead
    if available < num_cols * 5 then
        available = num_cols * 5  -- Absolute minimum
    end

    -- Start with all columns at natural width
    local allocated = {}
    local total = 0
    for i, w in ipairs(natural_widths) do
        allocated[i] = w
        total = total + w
    end

    -- If everything fits, we're done
    if total <= available then
        return allocated
    end

    -- Need to shrink - reduce largest columns first (minimizes wrap count)
    -- Only shrink columns that are "large" (> 15 chars) to avoid touching small ones
    local shrink_threshold = 15
    local min_after_shrink = 10  -- Don't shrink below this

    while total > available do
        -- Find the largest column that can be shrunk
        local max_idx = nil
        local max_val = 0
        for i = 1, num_cols do
            -- Can shrink if: large enough, above minimum, and was originally big
            if allocated[i] > min_after_shrink and
               natural_widths[i] > shrink_threshold and
               allocated[i] > max_val then
                max_idx = i
                max_val = allocated[i]
            end
        end

        if not max_idx then
            -- No large columns left to shrink - fall back to shrinking any column
            for i = 1, num_cols do
                if allocated[i] > min_after_shrink and allocated[i] > max_val then
                    max_idx = i
                    max_val = allocated[i]
                end
            end
        end

        if not max_idx then break end  -- Can't shrink anymore

        -- Shrink by amount needed, but not below minimum
        local need_to_save = total - available
        local can_shrink = allocated[max_idx] - min_after_shrink
        local shrink_amount = math.min(need_to_save, can_shrink)

        if shrink_amount <= 0 then break end

        allocated[max_idx] = allocated[max_idx] - shrink_amount
        total = total - shrink_amount
    end

    return allocated
end

-- Wrap cells in a table to fit target widths
-- Returns: output_rows, actual_widths, wrapped_cols (set of column indices that were wrapped)
function StreamFormatter:wrap_table_to_targets(rows, natural_widths, target_widths, cell_padding)
    local num_cols = #natural_widths
    local output_rows = {}
    local wrapped_cols = {}  -- Track which columns have wrapped content
    local is_header = true

    for _, row in ipairs(rows) do
        if row.type == "separator" then
            table.insert(output_rows, {type = "separator"})
            is_header = false
        elseif row.type == "data" then
            local wrapped_cells = {}
            local max_lines = 1

            for i = 1, num_cols do
                local cell = row.cells[i] or ""
                -- Allow both headers and data to wrap if they exceed target width
                if natural_widths[i] <= target_widths[i] then
                    wrapped_cells[i] = {cell}
                else
                    -- For data cells, wrap to (target - 2) to leave room for continuation indent
                    -- Headers don't get indented, so they can use full target width
                    local wrap_width = is_header and target_widths[i] or math.max(target_widths[i] - 2, 5)
                    wrapped_cells[i] = self:wrap_text_to_width(cell, wrap_width)
                    if #wrapped_cells[i] > 1 then
                        wrapped_cols[i] = true  -- Mark this column as wrapped
                    end
                end
                max_lines = math.max(max_lines, #wrapped_cells[i])
            end

            for line_num = 1, max_lines do
                local new_row = {
                    type = line_num == 1 and "data" or "continuation",
                    cells = {}
                }
                for i = 1, num_cols do
                    local line = wrapped_cells[i][line_num] or ""
                    -- Add indent for continuation lines (but not for header continuations)
                    if line_num > 1 and line ~= "" and not is_header then
                        line = "  " .. line
                    end
                    new_row.cells[i] = line
                end
                table.insert(output_rows, new_row)
            end

            if is_header then is_header = false end
        end
    end

    local actual_widths = {}
    for i = 1, num_cols do
        actual_widths[i] = 0
    end
    for _, row in ipairs(output_rows) do
        if row.cells then
            for i, cell in ipairs(row.cells) do
                actual_widths[i] = math.max(actual_widths[i] or 0, display_width(cell))
            end
        end
    end

    return output_rows, actual_widths, wrapped_cols
end

-- Format rows into a table string array
-- wrapped_cols is an optional set of column indices that should be left-justified
function StreamFormatter:format_rows_to_table(rows, widths, cell_padding, wrapped_cols)
    wrapped_cols = wrapped_cols or {}
    local result = {}
    local num_cols = #widths
    local is_header = true  -- Track if we're before the separator (header row)

    for _, row in ipairs(rows) do
        if row.type == "separator" then
            local parts = {}
            for i = 1, num_cols do
                parts[i] = string.rep("-", widths[i] + cell_padding * 2)
            end
            table.insert(result, "|" .. table.concat(parts, "|") .. "|")
            is_header = false
        else
            local parts = {}
            for i = 1, num_cols do
                local cell = row.cells[i] or ""
                local alignment

                -- Wrapped columns are always left-justified so indent is visible
                if wrapped_cols[i] then
                    alignment = "left"
                elseif i == 1 then
                    -- First column: center header, right-justify data
                    alignment = is_header and "center" or "right"
                elseif i == num_cols then
                    alignment = "left"
                else
                    alignment = "center"
                end

                local width = widths[i] or display_width(cell)
                local padding = width - display_width(cell)
                if padding < 0 then padding = 0 end

                local formatted
                if alignment == "right" then
                    formatted = string.rep(" ", padding) .. cell
                elseif alignment == "left" then
                    formatted = cell .. string.rep(" ", padding)
                else
                    local left_pad = math.floor(padding / 2)
                    local right_pad = padding - left_pad
                    formatted = string.rep(" ", left_pad) .. cell .. string.rep(" ", right_pad)
                end
                parts[i] = string.rep(" ", cell_padding) .. formatted .. string.rep(" ", cell_padding)
            end
            table.insert(result, "|" .. table.concat(parts, "|") .. "|")
        end
    end

    return result
end

-- Extract subset of columns from rows
function StreamFormatter:extract_columns(rows, col_indices, num_cols)
    local sub_rows = {}
    for _, row in ipairs(rows) do
        if row.type == "separator" then
            table.insert(sub_rows, {type = "separator"})
        elseif row.type == "data" or row.type == "continuation" then
            local has_content = (row.type == "data")
            local new_cells = {}
            for _, col_idx in ipairs(col_indices) do
                local cell = row.cells[col_idx] or ""
                new_cells[#new_cells + 1] = cell
                if cell:match("%S") then has_content = true end
            end
            if has_content then
                table.insert(sub_rows, {type = row.type, cells = new_cells})
            end
        end
    end
    return sub_rows
end

-- Smart table formatting with fair width distribution
function StreamFormatter:format_table_smart(rows, widths, max_width, cell_padding)
    local num_cols = #widths
    local total_width = self:calculate_table_width(widths, cell_padding)

    if total_width <= max_width then
        return {self:format_rows_to_table(rows, widths, cell_padding, {})}
    end

    local target_widths = self:calculate_target_widths(widths, max_width, cell_padding)
    local wrapped_rows, actual_widths, wrapped_cols = self:wrap_table_to_targets(rows, widths, target_widths, cell_padding)
    local wrapped_width = self:calculate_table_width(actual_widths, cell_padding)

    -- Count how many columns were wrapped
    local num_wrapped = 0
    for _ in pairs(wrapped_cols) do
        num_wrapped = num_wrapped + 1
    end

    -- Only use wrapping if table fits AND we wrapped at most 2 columns
    -- If more than 2 columns need wrapping, split the table instead
    if wrapped_width <= max_width and num_wrapped <= 2 then
        return {self:format_rows_to_table(wrapped_rows, actual_widths, cell_padding, wrapped_cols)}
    end

    -- Split into sub-tables, trying to maximize columns per sub-table
    -- while respecting the 2-wrapped-column limit and max wrap lines
    local max_wrap_lines = 4    -- Don't wrap data cells to more than this many lines
    local max_header_lines = 2  -- Headers can only wrap to 2 lines max

    -- Extract header widths (first data row before separator)
    local header_widths = {}
    for _, row in ipairs(rows) do
        if row.type == "separator" then break end
        if row.type == "data" then
            for i, cell in ipairs(row.cells) do
                header_widths[i] = display_width(cell)
            end
            break
        end
    end

    local sub_tables = {}
    local remaining_cols = {}
    for i = 2, num_cols do
        table.insert(remaining_cols, i)
    end

    while #remaining_cols > 0 do
        local current_cols = {1}
        local cols_added = {}

        -- Try to add columns, checking both natural and wrapped fits
        for _, col_idx in ipairs(remaining_cols) do
            -- Build test column set
            local test_cols = {}
            for _, c in ipairs(current_cols) do
                table.insert(test_cols, c)
            end
            table.insert(test_cols, col_idx)

            -- Get natural widths for test set
            local test_natural = {}
            for j, c in ipairs(test_cols) do
                test_natural[j] = widths[c]
            end

            -- Check if fits at natural widths
            local test_natural_width = self:calculate_table_width(test_natural, cell_padding)
            if test_natural_width <= max_width then
                -- Fits at natural widths - add it
                table.insert(current_cols, col_idx)
                table.insert(cols_added, col_idx)
            else
                -- Doesn't fit naturally - check if fits with wrapping
                local test_targets = self:calculate_target_widths(test_natural, max_width, cell_padding)
                local test_target_width = self:calculate_table_width(test_targets, cell_padding)

                -- Count how many columns would need wrapping and estimate max lines
                local would_wrap = 0
                local max_lines = 1
                local max_hdr_lines = 1
                for j = 1, #test_natural do
                    if test_natural[j] > test_targets[j] then
                        would_wrap = would_wrap + 1
                        -- Estimate lines needed for data (content / target width, rounded up)
                        local est_lines = math.ceil(test_natural[j] / test_targets[j])
                        if est_lines > max_lines then
                            max_lines = est_lines
                        end
                    end
                    -- Check header wrap lines separately
                    local col_idx = test_cols[j]
                    local hdr_width = header_widths[col_idx] or 0
                    if hdr_width > test_targets[j] then
                        local hdr_lines = math.ceil(hdr_width / test_targets[j])
                        if hdr_lines > max_hdr_lines then
                            max_hdr_lines = hdr_lines
                        end
                    end
                end

                -- Accept if: fits, ≤2 wrapped cols, ≤4 data lines, ≤2 header lines (or only 2 cols)
                local lines_ok = max_lines <= max_wrap_lines or #test_cols <= 2
                local hdr_ok = max_hdr_lines <= max_header_lines or #test_cols <= 2
                if test_target_width <= max_width and would_wrap <= 2 and lines_ok and hdr_ok then
                    -- Can fit with wrapping, within limits
                    table.insert(current_cols, col_idx)
                    table.insert(cols_added, col_idx)
                else
                    -- Can't fit, or would exceed wrap/lines limit
                    break
                end
            end
        end

        -- If no columns were added, force add the next one (unlimited lines allowed)
        if #cols_added == 0 and #remaining_cols > 0 then
            local col_idx = remaining_cols[1]
            table.insert(current_cols, col_idx)
            table.insert(cols_added, col_idx)
        end

        -- Format this sub-table
        local sub_rows = self:extract_columns(rows, current_cols, num_cols)
        local sub_natural = {}
        for j, col_idx in ipairs(current_cols) do
            sub_natural[j] = widths[col_idx]
        end

        local sub_natural_width = self:calculate_table_width(sub_natural, cell_padding)
        if sub_natural_width <= max_width then
            -- Fits at natural widths
            table.insert(sub_tables, self:format_rows_to_table(sub_rows, sub_natural, cell_padding, {}))
        else
            -- Needs wrapping
            local sub_targets = self:calculate_target_widths(sub_natural, max_width, cell_padding)
            local sub_wrapped, sub_actual, sub_wrapped_cols = self:wrap_table_to_targets(sub_rows, sub_natural, sub_targets, cell_padding)
            table.insert(sub_tables, self:format_rows_to_table(sub_wrapped, sub_actual, cell_padding, sub_wrapped_cols))
        end

        -- Remove added columns from remaining
        local new_remaining = {}
        local added_set = {}
        for _, c in ipairs(cols_added) do added_set[c] = true end
        for _, c in ipairs(remaining_cols) do
            if not added_set[c] then
                table.insert(new_remaining, c)
            end
        end
        remaining_cols = new_remaining
    end

    return sub_tables
end

-- Strip markdown formatting from text (bold, italic, code)
local function strip_markdown(text)
    -- Strip bold (**text** or __text__)
    text = text:gsub("%*%*(.-)%*%*", "%1")
    text = text:gsub("__(.-)__", "%1")
    -- Strip italic (*text* or _text_) - be careful not to match already-stripped bold
    text = text:gsub("%*(.-)%*", "%1")
    text = text:gsub("_(.-)_", "%1")
    -- Strip inline code (`text`)
    text = text:gsub("`(.-)`", "%1")
    return text
end

-- Parse table and format it
function StreamFormatter:format_table(lines)
    local rows = {}
    local max_cols = 0

    for _, line in ipairs(lines) do
        line = line:gsub("^%s+", ""):gsub("%s+$", "")
        local content = line:gsub("^|", ""):gsub("|$", "")

        if content:match("^[-%s:|]+$") and content:match("%-") then
            table.insert(rows, {type = "separator"})
        else
            local cells = {}
            local current = ""
            local j = 1
            while j <= #content do
                local c = content:sub(j, j)
                if c == "\\" and content:sub(j+1, j+1) == "|" then
                    current = current .. "|"
                    j = j + 2
                elseif c == "|" then
                    local cell = current:gsub("^%s+", ""):gsub("%s+$", "")
                    table.insert(cells, strip_markdown(cell))
                    current = ""
                    j = j + 1
                else
                    current = current .. c
                    j = j + 1
                end
            end
            local cell = current:gsub("^%s+", ""):gsub("%s+$", "")
            table.insert(cells, strip_markdown(cell))
            table.insert(rows, {type = "data", cells = cells})
            if #cells > max_cols then max_cols = #cells end
        end
    end

    -- Normalize rows
    for _, row in ipairs(rows) do
        if row.type == "data" then
            while #row.cells < max_cols do
                table.insert(row.cells, "")
            end
        end
    end

    -- Calculate column widths
    local widths = {}
    for _, row in ipairs(rows) do
        if row.type == "data" then
            for i, cell in ipairs(row.cells) do
                widths[i] = math.max(widths[i] or 0, display_width(cell))
            end
        end
    end

    local cell_padding = 1
    local max_width = self.line_width

    -- Use smart formatting with fair width distribution
    local sub_tables = self:format_table_smart(rows, widths, max_width, cell_padding)

    -- Join sub-tables with blank lines
    local result = {}
    for idx, sub_table in ipairs(sub_tables) do
        if idx > 1 then
            table.insert(result, "")
        end
        for _, line in ipairs(sub_table) do
            table.insert(result, line)
        end
    end

    return table.concat(result, "\n")
end

-- Wrap text at line width (for non-streaming use)
function StreamFormatter:wrap_line(text)
    if display_width(text) <= self.line_width then
        return text
    end

    local words = {}
    for word in text:gmatch("%S+") do
        table.insert(words, word)
    end

    if #words == 0 then return "" end

    local lines = {}
    local current = ""
    local current_width = 0

    for _, word in ipairs(words) do
        local word_width = display_width(word)
        if current == "" then
            current = word
            current_width = word_width
        elseif current_width + 1 + word_width <= self.line_width then
            current = current .. " " .. word
            current_width = current_width + 1 + word_width
        else
            table.insert(lines, current)
            current = word
            current_width = word_width
        end
    end

    if current ~= "" then
        table.insert(lines, current)
    end

    return table.concat(lines, "\n")
end

-- Process streaming token character by character
-- Returns nothing - writes directly to stdout for real-time display
function StreamFormatter:process_token(token)
    for i = 1, #token do
        local char = token:sub(i, i)
        self:process_char(char)
    end
end

-- Check if a line is a "structural" element (headers, lists, code blocks)
-- These should NOT be joined with paragraph buffering
function StreamFormatter:is_structural_line(line)
    if not line or line == "" then return false end  -- Blank lines are NOT structural

    -- Horizontal rule: --- or *** or ___
    if line:match("^%s*[%-]+%s*$") or line:match("^%s*[%*]+%s*$") or line:match("^%s*[_]+%s*$") then
        return true
    end

    -- Headers: # ## ### etc.
    if line:match("^#+%s") then return true end

    -- Blockquotes: > text
    if line:match("^>") then return true end

    -- Bullet points: - item or * item
    if line:match("^[%-]%s+") or line:match("^[%*]%s+") then return true end

    -- Numbered lists: 1. item
    if line:match("^%d+%.%s+") then return true end

    -- Code fence: ```
    if line:match("^%s*```") then return true end

    -- Table line: |
    if line:match("^%s*|") then return true end

    return false
end

-- Check if a line is "special" (not a regular paragraph line)
-- Special lines should not be joined with paragraph buffering
function StreamFormatter:is_special_line(line)
    if not line or line == "" then return true end  -- Blank lines are "special" (paragraph breaks)
    return self:is_structural_line(line)
end

-- Flush the paragraph buffer - join lines and output with wrapping
function StreamFormatter:flush_paragraph_buffer(force)
    if self.paragraph_buffer == "" then return end

    -- Only flush if forced (structural element/tool call) OR buffer has substantial content
    -- This prevents premature flushing on spurious blank lines from LLM
    if not force and #self.paragraph_buffer < 60 then
        return  -- Keep accumulating
    end

    -- Output the combined paragraph text
    self:output_line_with_markdown(self.paragraph_buffer)
    io.write("\n")
    self.paragraph_buffer = ""
end

-- Process a single character with real-time word wrapping
function StreamFormatter:process_char(char)
    -- Build line buffer for table/code block detection
    if char ~= "\n" then
        self.line_buffer = self.line_buffer .. char
    end

    if char == "\n" then
        -- Check for code fence: ``` or ```lang
        local fence, lang = self.line_buffer:match("^%s*(```+)(%w*)")
        local is_code_fence = fence ~= nil

        -- Check if this is a table line
        local is_table_line = self.line_buffer:match("^%s*|") and self.format_tables and not self.md.in_code_block

        -- Handle code blocks
        if is_code_fence then
            -- Flush paragraph buffer before code block (force flush)
            self:flush_paragraph_buffer(true)

            if self.md.in_code_block then
                -- End code block - output buffered content with highlighting
                for _, line in ipairs(self.md.code_block_lines) do
                    io.write(self:highlight_code_line(line, self.md.code_block_lang))
                    io.write("\n")
                end
                self.md.in_code_block = false
                self.md.code_block_lang = nil
                self.md.code_block_lines = {}
            else
                -- Start code block
                self.md.in_code_block = true
                self.md.code_block_lang = lang ~= "" and lang or nil
                self.md.code_block_lines = {}
            end
        elseif self.md.in_code_block then
            -- Inside code block - buffer the line
            table.insert(self.md.code_block_lines, self.line_buffer)
        elseif is_table_line then
            -- Flush paragraph buffer before table (force flush)
            self:flush_paragraph_buffer(true)

            if not self.in_table then
                self.in_table = true
                self.table_lines = {}
            end
            -- Don't print anything - just buffer
            table.insert(self.table_lines, self.line_buffer)
        elseif self.in_table then
            -- Table just ended - output formatted table
            io.write(self:format_table(self.table_lines))
            io.write("\n")
            self.in_table = false
            self.table_lines = {}
            self.line_start = false
            self.pending_output = ""

            -- Handle the current non-table line
            if self:is_structural_line(self.line_buffer) then
                -- Structural line - output directly
                self:output_line_with_markdown(self.line_buffer)
                io.write("\n")
            elseif self.line_buffer == "" then
                -- Blank line after table
                io.write("\n")
            else
                -- Regular paragraph line - start buffering
                self.paragraph_buffer = self.line_buffer
            end
        elseif self:is_structural_line(self.line_buffer) then
            -- Structural line (header, bullet, etc.) - force flush and output
            self:flush_paragraph_buffer(true)
            self:output_line_with_markdown(self.line_buffer)
            io.write("\n")
        elseif self.line_buffer == "" then
            -- Blank line - try to flush (but don't force if buffer is small)
            self:flush_paragraph_buffer(false)
            io.write("\n")
        else
            -- Regular paragraph line - add to paragraph buffer
            if self.paragraph_buffer == "" then
                self.paragraph_buffer = self.line_buffer
            else
                -- Join with space (the newline becomes a space in flowing text)
                self.paragraph_buffer = self.paragraph_buffer .. " " .. self.line_buffer
            end
        end

        -- Reset line state
        self.col = 0
        self.word_start_col = 0
        self.current_word = ""
        self.line_buffer = ""
        self.line_start = true
        self.pending_output = ""
        io.flush()

    elseif self.md.in_code_block then
        -- Inside code block - just buffer, don't print
        -- (line_buffer is being built)

    elseif self.in_table then
        -- Already in table mode - just buffer, don't print
        -- (line_buffer is being built)

    elseif self.line_start then
        -- At start of line - check if this starts a table
        if char == "|" and self.format_tables then
            -- This is a table line - enter table mode
            self.in_table = true
            self.table_lines = {}
            self.line_start = false
        elseif char ~= " " and char ~= "\t" then
            -- First non-whitespace - no longer at line start
            self.line_start = false
        end
        -- All characters go to line_buffer (already added above)
        -- Will be processed at newline

    else
        -- Normal characters - just buffer in line_buffer
        -- Will be processed at newline
    end
end

-- Flush any remaining buffered content at end of stream
function StreamFormatter:flush()
    -- Flush any remaining code block
    if self.md.in_code_block and #self.md.code_block_lines > 0 then
        for _, line in ipairs(self.md.code_block_lines) do
            io.write(self:highlight_code_line(line, self.md.code_block_lang))
            io.write("\n")
        end
        self.md.in_code_block = false
        self.md.code_block_lang = nil
        self.md.code_block_lines = {}
    elseif self.in_table and #self.table_lines > 0 then
        io.write(self:format_table(self.table_lines))
        io.write("\n")
        self.in_table = false
        self.table_lines = {}
    end

    -- Combine any remaining line buffer with paragraph buffer
    if #self.line_buffer > 0 then
        if self.paragraph_buffer == "" then
            self.paragraph_buffer = self.line_buffer
        else
            self.paragraph_buffer = self.paragraph_buffer .. " " .. self.line_buffer
        end
        self.line_buffer = ""
    end

    -- Flush the combined paragraph buffer
    if self.paragraph_buffer ~= "" then
        self:output_line_with_markdown(self.paragraph_buffer)
        self.paragraph_buffer = ""
    end

    -- Flush any remaining current word
    if #self.current_word > 0 then
        io.write(self:render_markdown(self.current_word))
        self.current_word = ""
    end

    -- End any active markdown formatting
    io.write(self:end_markdown_line())
    io.flush()
    -- No return value - we write directly
    return ""
end

--------------------------------------------------------------------------------
-- UI Class
--------------------------------------------------------------------------------

-- Create a new UI instance
function UI.new(config)
    local self = setmetatable({}, UI)
    self.config = config or {}
    self.formatter = StreamFormatter.new(self.config)
    return self
end

-- Startup tips - shown randomly at launch
local startup_tips = {
    "Use 'clear' to reset the conversation and start fresh.",
    "End a line with \\ to continue typing on the next line.",
    "Press Shift+Enter for multiline input (in supported terminals).",
    "Tools can read and write files - ask the assistant to help with code!",
    "Use Ctrl+C to cancel the current response.",
    "The assistant remembers your entire conversation until you 'clear'.",
    "Create a 'tools/' directory to add custom tools for this project.",
    "Tool outputs are automatically shown to the assistant.",
    "Ask the assistant to explain code, refactor, or write tests.",
    "Use 'quit' or 'exit' to end the session.",
    "The assistant can generate images if ComfyUI is configured.",
    "Press Up/Down arrows to navigate through input history.",
    "Long responses are automatically word-wrapped to fit your terminal.",
    "Tables in markdown are automatically formatted for readability.",
    "You can ask the assistant to lint and format documentation files.",
}

-- Print with color
function UI:print_colored(color, text)
    print(self.colors[color] .. text .. self.colors.reset)
end

-- Print a random tip
function UI:print_random_tip()
    math.randomseed(os.time())
    local tip = startup_tips[math.random(#startup_tips)]
    self:print_colored("dim", "Tip: " .. tip)
end

-- Print startup banner
function UI:print_banner(chat_info, tool_names, lib_config)
    local c = self.colors
    print(c.cyan .. "Terminal Chatbot" .. c.reset .. " (Ollama @ " .. chat_info.host .. ":" .. chat_info.port .. ")")

    -- Model info with capabilities
    local model_info = c.yellow .. chat_info.model .. c.reset
    local caps = {}
    if chat_info.think then
        table.insert(caps, "thinking")
    end
    if chat_info.capabilities and chat_info.capabilities.vision then
        table.insert(caps, "vision")
    end
    if #caps > 0 then
        model_info = model_info .. c.dim .. " [" .. table.concat(caps, ", ") .. "]" .. c.reset
    end
    print("Model: " .. model_info)

    if tool_names and #tool_names > 0 then
        print("Tools: " .. c.yellow .. table.concat(tool_names, ", ") .. c.reset)
    end
    print("Commands: " .. c.dim .. "quit, exit, clear" .. c.reset)
    print("Multiline: " .. c.dim .. "\\ + Enter or Shift+Enter" .. c.reset)
    print(string.rep("-", 50))

    -- Check for warnings (config vs actual capabilities)
    local warnings = {}
    local resolutions = {}

    -- Check thinking mismatch
    local config_think = lib_config and lib_config.think
    local model_thinks = chat_info.think
    if config_think and not model_thinks then
        table.insert(warnings, "config.think is enabled but " .. c.yellow .. chat_info.model .. c.reset .. " doesn't support thinking")
        table.insert(resolutions, "Thinking " .. c.yellow .. "disabled" .. c.reset .. " for this session")
    end

    -- Check vision - if model doesn't have vision but vision fallback is enabled
    local has_vision = chat_info.capabilities and chat_info.capabilities.vision
    local vision_config = lib_config and lib_config.image_generation and lib_config.image_generation.vision
    if not has_vision and vision_config and vision_config.enabled then
        local fallback_model = vision_config.model or "moondream"
        table.insert(warnings, c.yellow .. chat_info.model .. c.reset .. " doesn't support vision")
        table.insert(resolutions, "Using " .. c.cyan .. fallback_model .. c.reset .. " as a fallback for image descriptions")
    end

    -- Display warnings if any
    if #warnings > 0 then
        print()
        for i, warning in ipairs(warnings) do
            print(c.red .. "Warning: " .. c.reset .. warning)
            if resolutions[i] then
                print(c.green .. "  -> " .. c.reset .. resolutions[i])
            end
        end
        print()
        print(string.rep("-", 50))
    end
end

-- Print assistant prefix
function UI:print_assistant_prefix()
    io.write("\n" .. self.colors.blue .. "Assistant: " .. self.colors.reset)
    io.flush()
end

-- Read user input
function UI:read_input()
    io.write("\n")
    local input = rl.readline(
        self.colors.green .. "You: " .. self.colors.reset,
        self.colors.green .. "...  " .. self.colors.reset
    )

    if not input then
        return nil
    end

    return input:match("^%s*(.-)%s*$")
end

-- Print goodbye message
function UI:print_goodbye()
    self:print_colored("cyan", "Goodbye!")
end

-- Print clear message
function UI:print_cleared()
    self:print_colored("dim", "Conversation cleared.")
end

-- Print error
function UI:print_error(message)
    self:print_colored("red", message)
end

-- Create streaming callbacks for chat
function UI:create_callbacks()
    local c = self.colors
    local in_thinking = false
    local formatter = self.formatter
    local show_vision_debug = self.config.show_vision_debug ~= false

    -- Reset formatter for new response
    formatter:reset()

    return {
        on_thinking_start = function()
            in_thinking = true
            io.write(c.dim .. "... ")
        end,

        on_thinking = function(text)
            io.write(text)
            io.flush()
        end,

        on_thinking_end = function()
            in_thinking = false
            io.write(" ..." .. c.reset .. "\n\n")
        end,

        on_content = function(text)
            -- Formatter writes directly to stdout for real-time display
            formatter:process_token(text)
        end,

        on_tool_call = function(name)
            -- Flush any buffered table before tool output
            formatter:flush()
            print()  -- Blank line before tool call for visual separation
            print(c.yellow .. "[Tool: " .. name .. "]" .. c.reset)
        end,

        on_tool_result = function(name, result)
            if result.success then
                local msg
                if result.message then
                    msg = result.message
                elseif result.type == "directory" then
                    msg = "-> " .. result.path .. " (" .. (result.item_count or "?") .. " items)"
                elseif result.type == "file" then
                    msg = "-> " .. result.path .. " (" .. result.total_lines .. " lines)"
                elseif result.type == "binary" then
                    msg = "-> " .. result.path .. " (binary, " .. result.size .. " bytes)"
                else
                    msg = "Done"
                end
                print(c.green .. "  " .. msg .. c.reset)

                -- Show vision model description in cyan if enabled
                if show_vision_debug and result.image_description then
                    print()
                    -- Wrap the vision description at line width minus indent
                    local desc = result.image_description
                    local max_width = (self.config.output_line_width or 100) - 4  -- account for "  " indent
                    local wrapped = formatter:wrap_line(desc)
                    for line in (wrapped .. "\n"):gmatch("([^\n]*)\n") do
                        if line ~= "" then
                            print(c.cyan .. "  " .. line .. c.reset)
                        end
                    end
                    print()
                end

                -- Display image if tool returned one
                if result.display_image then
                    local img_path = result.display_image
                    -- Detect terminal and display image
                    local kitty = os.getenv("KITTY_WINDOW_ID")
                    local ghostty = os.getenv("GHOSTTY_RESOURCES_DIR")
                    if kitty or ghostty then
                        os.execute(string.format('kitty +kitten icat "%s" 2>/dev/null', img_path))
                    else
                        os.execute(string.format('img2txt -W 80 -H 40 "%s" 2>/dev/null', img_path))
                    end
                end
            else
                print(c.red .. "  Error: " .. (result.error or "unknown") .. c.reset)
            end
        end,

        on_done = function()
            -- Flush any remaining buffered table
            formatter:flush()
            print()  -- newline after streaming
        end,
    }
end

-- Main loop
function UI:run(chat)
    -- Print random tip at startup
    self:print_random_tip()

    -- Print startup banner with config for warnings
    self:print_banner(chat:get_info(), chat:get_tool_names(), chat:get_config())

    while true do
        local input = self:read_input()

        if not input then
            break
        end

        if input == "" then
            -- Skip empty input
        elseif input == "quit" or input == "exit" then
            self:print_goodbye()
            break
        elseif input == "clear" then
            chat:clear()
            self:print_cleared()
        else
            self:print_assistant_prefix()
            local callbacks = self:create_callbacks()
            local ok, err = chat:send(input, callbacks)
            if not ok then
                self:print_error(err)
            end
        end
    end
end

return UI
