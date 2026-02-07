-- core/context.lua
-- Local context: maximal access to local resources

local M = {}

-- Scope flags (what context is accessible)
M.scope = {
    fs = true,      -- filesystem
    env = true,     -- environment variables
    proc = true,    -- process info
    net = false,    -- network state (opt-in)
    sys = true,     -- system info
    conv = true,    -- conversation history
}

-- Conversation context (messages)
M.conversation = {
    messages = {},
    metadata = {}
}

-- System info cache
local sys_info = nil

-- Get system info (cached)
function M.get_sys()
    if sys_info then return sys_info end

    local hostname = io.popen("hostname"):read("*l") or "unknown"
    local user = os.getenv("USER") or os.getenv("USERNAME") or "unknown"
    local os_name = io.popen("uname -s 2>/dev/null"):read("*l") or "unknown"
    local os_release = io.popen("uname -r 2>/dev/null"):read("*l") or ""
    local arch = io.popen("uname -m 2>/dev/null"):read("*l") or "unknown"
    local pwd = io.popen("pwd"):read("*l") or "."

    sys_info = {
        hostname = hostname,
        user = user,
        os = os_name,
        os_release = os_release,
        arch = arch,
        pwd = pwd,
        pid = tostring(io.popen("echo $$"):read("*l") or "?"),
        time = os.time(),
        date = os.date("%Y-%m-%d %H:%M:%S")
    }
    return sys_info
end

-- Refresh system info
function M.refresh_sys()
    sys_info = nil
    return M.get_sys()
end

-- Filesystem operations
function M.fs_read(path)
    if not M.scope.fs then
        return nil, "filesystem access disabled"
    end
    local f, err = io.open(path, "r")
    if not f then
        return nil, err
    end
    local content = f:read("*a")
    f:close()
    return content
end

function M.fs_write(path, content)
    if not M.scope.fs then
        return nil, "filesystem access disabled"
    end
    local f, err = io.open(path, "w")
    if not f then
        return nil, err
    end
    f:write(content)
    f:close()
    return true
end

function M.fs_exists(path)
    if not M.scope.fs then
        return nil, "filesystem access disabled"
    end
    local f = io.open(path, "r")
    if f then
        f:close()
        return true
    end
    return false
end

function M.fs_list(path)
    if not M.scope.fs then
        return nil, "filesystem access disabled"
    end
    local entries = {}
    local p = io.popen('ls -la "' .. path .. '" 2>/dev/null')
    if p then
        for line in p:lines() do
            table.insert(entries, line)
        end
        p:close()
    end
    return entries
end

function M.fs_stat(path)
    if not M.scope.fs then
        return nil, "filesystem access disabled"
    end
    local p = io.popen('stat "' .. path .. '" 2>/dev/null')
    if p then
        local output = p:read("*a")
        p:close()
        return output
    end
    return nil, "stat failed"
end

-- Environment operations
function M.env_get(var)
    if not M.scope.env then
        return nil, "environment access disabled"
    end
    return os.getenv(var)
end

function M.env_all()
    if not M.scope.env then
        return nil, "environment access disabled"
    end
    local env = {}
    local p = io.popen("env")
    if p then
        for line in p:lines() do
            local k, v = line:match("^([^=]+)=(.*)$")
            if k then
                env[k] = v
            end
        end
        p:close()
    end
    return env
end

-- Process operations
function M.proc_exec(command)
    if not M.scope.proc then
        return nil, "process execution disabled"
    end
    local p = io.popen(command .. " 2>&1")
    if p then
        local output = p:read("*a")
        local ok, exit_type, code = p:close()
        return {
            output = output,
            success = ok,
            exit_type = exit_type,
            exit_code = code
        }
    end
    return nil, "exec failed"
end

function M.proc_list()
    if not M.scope.proc then
        return nil, "process access disabled"
    end
    local procs = {}
    local p = io.popen("ps aux 2>/dev/null")
    if p then
        for line in p:lines() do
            table.insert(procs, line)
        end
        p:close()
    end
    return procs
end

-- Network operations (opt-in)
function M.net_interfaces()
    if not M.scope.net then
        return nil, "network access disabled"
    end
    local ifaces = {}
    local p = io.popen("ip addr 2>/dev/null || ifconfig 2>/dev/null")
    if p then
        local output = p:read("*a")
        p:close()
        return output
    end
    return nil, "network info unavailable"
end

function M.net_connections()
    if not M.scope.net then
        return nil, "network access disabled"
    end
    local p = io.popen("ss -tuln 2>/dev/null || netstat -tuln 2>/dev/null")
    if p then
        local output = p:read("*a")
        p:close()
        return output
    end
    return nil, "connection info unavailable"
end

-- Conversation context
function M.conv_add(role, content)
    if not M.scope.conv then
        return nil, "conversation access disabled"
    end
    table.insert(M.conversation.messages, {
        role = role,
        content = content,
        timestamp = os.time()
    })
    return #M.conversation.messages
end

function M.conv_get()
    if not M.scope.conv then
        return nil, "conversation access disabled"
    end
    return M.conversation.messages
end

function M.conv_clear()
    if not M.scope.conv then
        return nil, "conversation access disabled"
    end
    M.conversation.messages = {}
    return true
end

function M.conv_set_meta(key, value)
    if not M.scope.conv then
        return nil, "conversation access disabled"
    end
    M.conversation.metadata[key] = value
    return true
end

function M.conv_get_meta(key)
    if not M.scope.conv then
        return nil, "conversation access disabled"
    end
    return M.conversation.metadata[key]
end

-- Unified context snapshot
function M.snapshot()
    return {
        sys = M.scope.sys and M.get_sys() or nil,
        env = M.scope.env and { USER = os.getenv("USER"), HOME = os.getenv("HOME") } or nil,
        conv = M.scope.conv and {
            message_count = #M.conversation.messages,
            metadata = M.conversation.metadata
        } or nil,
        scope = M.scope
    }
end

-- Set scope
function M.set_scope(new_scope)
    for k, v in pairs(new_scope) do
        if M.scope[k] ~= nil then
            M.scope[k] = v
        end
    end
end

return M
