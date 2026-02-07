-- core/distributed/tensor.lua
-- Tensor serialization for distributed inference

local M = {}

-- Supported dtypes
M.DTYPE = {
    FLOAT32 = "float32",
    FLOAT16 = "float16",
    BFLOAT16 = "bfloat16",
    INT8 = "int8",
    INT4 = "int4"
}

-- Bytes per element
M.DTYPE_SIZE = {
    float32 = 4,
    float16 = 2,
    bfloat16 = 2,
    int8 = 1,
    int4 = 0.5
}

-- Calculate tensor size in bytes
function M.calc_size(shape, dtype)
    local elements = 1
    for _, dim in ipairs(shape) do
        elements = elements * dim
    end
    return math.ceil(elements * (M.DTYPE_SIZE[dtype] or 4))
end

-- Estimate transfer time (milliseconds)
function M.estimate_transfer_ms(shape, dtype, bandwidth_gbps)
    local bytes = M.calc_size(shape, dtype)
    local bits = bytes * 8
    local gbits = bits / 1e9
    return (gbits / bandwidth_gbps) * 1000
end

-- Base64 encoding (safe for JSON transport)
local b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function M.base64_encode(data)
    return ((data:gsub('.', function(x)
        local r, b = '', x:byte()
        for i = 8, 1, -1 do r = r .. (b % 2^i - b % 2^(i-1) > 0 and '1' or '0') end
        return r
    end) .. '0000'):gsub('%d%d%d?%d?%d?%d?', function(x)
        if #x < 6 then return '' end
        local c = 0
        for i = 1, 6 do c = c + (x:sub(i, i) == '1' and 2^(6-i) or 0) end
        return b64chars:sub(c+1, c+1)
    end) .. ({ '', '==', '=' })[#data % 3 + 1])
end

function M.base64_decode(data)
    data = string.gsub(data, '[^' .. b64chars .. '=]', '')
    return (data:gsub('.', function(x)
        if x == '=' then return '' end
        local r, f = '', (b64chars:find(x) - 1)
        for i = 6, 1, -1 do r = r .. (f % 2^i - f % 2^(i-1) > 0 and '1' or '0') end
        return r
    end):gsub('%d%d%d?%d?%d?%d?%d?%d?', function(x)
        if #x ~= 8 then return '' end
        local c = 0
        for i = 1, 8 do c = c + (x:sub(i, i) == '1' and 2^(8-i) or 0) end
        return string.char(c)
    end))
end

-- Simple checksum (xxhash would be better, but this works)
function M.checksum(data)
    local sum = 0
    for i = 1, #data do
        sum = (sum * 31 + data:byte(i)) % 0xFFFFFFFF
    end
    return string.format("%08x", sum)
end

-- Serialize tensor for network transfer
function M.serialize(data, shape, dtype, options)
    options = options or {}
    local encoding = options.encoding or "base64"

    local payload
    if encoding == "base64" then
        payload = M.base64_encode(data)
    elseif encoding == "raw" then
        payload = data
    else
        error("unknown encoding: " .. encoding)
    end

    return {
        shape = shape,
        dtype = dtype or M.DTYPE.FLOAT16,
        encoding = encoding,
        size = #data,
        checksum = M.checksum(data),
        data = payload
    }
end

-- Deserialize tensor from network
function M.deserialize(msg)
    local data
    if msg.encoding == "base64" then
        data = M.base64_decode(msg.data)
    elseif msg.encoding == "raw" then
        data = msg.data
    else
        return nil, "unknown encoding: " .. msg.encoding
    end

    -- Verify checksum
    local computed = M.checksum(data)
    if computed ~= msg.checksum then
        return nil, "checksum mismatch: expected " .. msg.checksum .. ", got " .. computed
    end

    -- Verify size
    if #data ~= msg.size then
        return nil, "size mismatch: expected " .. msg.size .. ", got " .. #data
    end

    return {
        data = data,
        shape = msg.shape,
        dtype = msg.dtype
    }
end

-- Create activation message for peer protocol
function M.create_activation_message(session_id, layer, data, shape, dtype)
    local tensor = M.serialize(data, shape, dtype)
    return {
        type = "infer_act",
        session_id = session_id,
        layer = layer,
        tensor = tensor,
        timestamp = os.time()
    }
end

-- Parse activation message
function M.parse_activation_message(msg)
    if msg.type ~= "infer_act" then
        return nil, "not an activation message"
    end

    local tensor, err = M.deserialize(msg.tensor)
    if not tensor then
        return nil, err
    end

    return {
        session_id = msg.session_id,
        layer = msg.layer,
        tensor = tensor,
        timestamp = msg.timestamp
    }
end

-- Utility: format size for display
function M.format_size(bytes)
    if bytes < 1024 then
        return string.format("%d B", bytes)
    elseif bytes < 1024 * 1024 then
        return string.format("%.1f KB", bytes / 1024)
    elseif bytes < 1024 * 1024 * 1024 then
        return string.format("%.1f MB", bytes / (1024 * 1024))
    else
        return string.format("%.2f GB", bytes / (1024 * 1024 * 1024))
    end
end

-- Print tensor info
function M.info(shape, dtype)
    local size = M.calc_size(shape, dtype)
    local shape_str = table.concat(shape, " x ")
    return string.format("[%s] %s = %s", shape_str, dtype, M.format_size(size))
end

return M
