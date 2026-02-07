-- core/executor.lua
-- Execute operations against local context

local operation = require("core.operation")
local context = require("core.context")

local M = {}

-- Operation handlers (name -> function)
M.handlers = {}

-- Register default handlers
local function register_defaults()
    -- Send message (chat)
    M.handlers[operation.OP_TYPES.MESSAGE] = function(args)
        if not args.text then
            return nil, "message text required"
        end
        context.conv_add("user", args.text)
        return {
            received = true,
            message_id = #context.conversation.messages,
            text = args.text
        }
    end

    -- Read file
    M.handlers[operation.OP_TYPES.READ_FILE] = function(args)
        if not args.path then
            return nil, "path required"
        end
        local content, err = context.fs_read(args.path)
        if not content then
            return nil, err
        end
        return {
            path = args.path,
            content = content,
            size = #content
        }
    end

    -- Write file
    M.handlers[operation.OP_TYPES.WRITE_FILE] = function(args)
        if not args.path then
            return nil, "path required"
        end
        if not args.content then
            return nil, "content required"
        end
        local ok, err = context.fs_write(args.path, args.content)
        if not ok then
            return nil, err
        end
        return {
            path = args.path,
            written = #args.content
        }
    end

    -- Execute command
    M.handlers[operation.OP_TYPES.EXEC] = function(args)
        if not args.command then
            return nil, "command required"
        end
        local result, err = context.proc_exec(args.command)
        if not result then
            return nil, err
        end
        return result
    end

    -- Get environment variable
    M.handlers[operation.OP_TYPES.GET_ENV] = function(args)
        if not args.var then
            return nil, "variable name required"
        end
        local value = context.env_get(args.var)
        return {
            var = args.var,
            value = value,
            exists = value ~= nil
        }
    end

    -- Set context metadata
    M.handlers[operation.OP_TYPES.SET_CONTEXT] = function(args)
        if not args.key then
            return nil, "key required"
        end
        context.conv_set_meta(args.key, args.value)
        return {
            key = args.key,
            set = true
        }
    end

    -- Get context
    M.handlers[operation.OP_TYPES.GET_CONTEXT] = function(args)
        if args.key then
            return {
                key = args.key,
                value = context.conv_get_meta(args.key)
            }
        else
            return {
                snapshot = context.snapshot()
            }
        end
    end

    -- Query (flexible local resource query)
    M.handlers[operation.OP_TYPES.QUERY] = function(args)
        local scope = args.scope or "all"
        local query = args.query

        local results = {}

        if scope == "all" or scope == "sys" then
            results.sys = context.get_sys()
        end

        if scope == "all" or scope == "env" then
            if query then
                results.env = { [query] = context.env_get(query) }
            else
                results.env = context.env_all()
            end
        end

        if scope == "all" or scope == "fs" then
            if query then
                results.fs = {
                    exists = context.fs_exists(query),
                    path = query
                }
            end
        end

        if scope == "all" or scope == "conv" then
            results.conv = {
                messages = context.conv_get(),
                metadata = context.conversation.metadata
            }
        end

        return results
    end
end

-- Execute an operation
function M.execute(op)
    -- Validate
    local valid, err = operation.validate(op)
    if not valid then
        return operation.result(op.id, false, nil, err)
    end

    -- Find handler
    local handler = M.handlers[op.name]
    if not handler then
        -- Try external tools (hook point for Chat:execute_tool)
        if M.external_executor then
            local result, err = M.external_executor(op.name, op.args)
            if result then
                return operation.result(op.id, true, result, nil)
            else
                return operation.result(op.id, false, nil, err or "external execution failed")
            end
        end
        return operation.result(op.id, false, nil, "no handler for: " .. op.name)
    end

    -- Execute
    local ok, data_or_err, maybe_err = pcall(handler, op.args)
    if not ok then
        return operation.result(op.id, false, nil, data_or_err)
    end

    if data_or_err == nil and maybe_err then
        return operation.result(op.id, false, nil, maybe_err)
    end

    return operation.result(op.id, true, data_or_err, nil)
end

-- Register custom handler
function M.register(name, handler)
    M.handlers[name] = handler
end

-- Set external executor (for existing tools)
function M.set_external_executor(fn)
    M.external_executor = fn
end

-- Initialize
function M.init()
    register_defaults()
end

-- Execute and return both operation and result (convenience)
function M.run(name, args, origin)
    local op = operation.create(name, args, origin)
    local result = M.execute(op)
    return op, result
end

M.init()

return M
