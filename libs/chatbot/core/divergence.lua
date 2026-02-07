-- core/divergence.lua
-- Track divergences between peers. Never fully reconcile.

local json = require("libs.dkjson")

local M = {}

-- Storage: op_id -> divergence record
M.records = {}

-- Divergence states
M.STATE = {
    PENDING = "pending",       -- waiting for other peer's result
    CONVERGED = "converged",   -- results match (but never fully trusted)
    DIVERGED = "diverged",     -- results differ
    PARTIAL = "partial",       -- only one result available
}

-- Create or update divergence record
function M.record(op_id, peer_id, result)
    if not M.records[op_id] then
        M.records[op_id] = {
            op_id = op_id,
            results = {},
            state = M.STATE.PENDING,
            created_at = os.time(),
            updated_at = os.time(),
            reconciled = false  -- never becomes true
        }
    end

    local rec = M.records[op_id]
    rec.results[peer_id] = {
        data = result.data,
        success = result.success,
        error = result.error,
        timestamp = result.timestamp,
        received_at = os.time()
    }
    rec.updated_at = os.time()

    -- Update state
    rec.state = M.compute_state(rec)

    return rec
end

-- Compute divergence state
function M.compute_state(rec)
    local peers = {}
    for peer_id, _ in pairs(rec.results) do
        table.insert(peers, peer_id)
    end

    if #peers < 2 then
        return M.STATE.PARTIAL
    end

    -- Compare results
    local first_peer = peers[1]
    local first_result = rec.results[first_peer]

    for i = 2, #peers do
        local other_result = rec.results[peers[i]]
        if not M.results_match(first_result, other_result) then
            return M.STATE.DIVERGED
        end
    end

    return M.STATE.CONVERGED
end

-- Deep compare results (but never fully trust)
function M.results_match(a, b)
    -- Success status must match
    if a.success ~= b.success then
        return false
    end

    -- Both failed: compare errors
    if not a.success and not b.success then
        return a.error == b.error
    end

    -- Both succeeded: compare data
    return M.deep_equal(a.data, b.data)
end

-- Deep equality (with tolerance for floating point)
function M.deep_equal(a, b)
    local type_a = type(a)
    local type_b = type(b)

    if type_a ~= type_b then
        return false
    end

    if type_a == "number" then
        -- Floating point tolerance
        return math.abs(a - b) < 0.0001
    end

    if type_a ~= "table" then
        return a == b
    end

    -- Table comparison
    local keys_a = {}
    for k in pairs(a) do keys_a[k] = true end

    for k in pairs(b) do
        if not keys_a[k] then
            return false
        end
    end

    for k in pairs(a) do
        if not M.deep_equal(a[k], b[k]) then
            return false
        end
    end

    return true
end

-- Get divergence record
function M.get(op_id)
    return M.records[op_id]
end

-- Get all diverged records
function M.get_diverged()
    local diverged = {}
    for op_id, rec in pairs(M.records) do
        if rec.state == M.STATE.DIVERGED then
            table.insert(diverged, rec)
        end
    end
    return diverged
end

-- Get summary
function M.summary()
    local counts = {
        total = 0,
        pending = 0,
        converged = 0,
        diverged = 0,
        partial = 0
    }

    for _, rec in pairs(M.records) do
        counts.total = counts.total + 1
        counts[rec.state] = (counts[rec.state] or 0) + 1
    end

    return counts
end

-- Export divergence details for an operation
function M.explain(op_id)
    local rec = M.records[op_id]
    if not rec then
        return nil, "no record for op_id: " .. op_id
    end

    local explanation = {
        op_id = op_id,
        state = rec.state,
        peer_count = 0,
        peers = {}
    }

    for peer_id, result in pairs(rec.results) do
        explanation.peer_count = explanation.peer_count + 1
        explanation.peers[peer_id] = {
            success = result.success,
            data_preview = M.preview(result.data),
            error = result.error
        }
    end

    if rec.state == M.STATE.DIVERGED then
        explanation.differences = M.find_differences(rec.results)
    end

    return explanation
end

-- Create data preview (truncated for display)
function M.preview(data, max_len)
    max_len = max_len or 100
    local s = json.encode(data) or tostring(data)
    if #s > max_len then
        return string.sub(s, 1, max_len) .. "..."
    end
    return s
end

-- Find specific differences between results
function M.find_differences(results)
    local diffs = {}
    local peers = {}
    for peer_id in pairs(results) do
        table.insert(peers, peer_id)
    end

    if #peers < 2 then return diffs end

    local base = results[peers[1]]
    for i = 2, #peers do
        local other = results[peers[i]]
        local peer_diff = {
            peer_a = peers[1],
            peer_b = peers[i],
            paths = {}
        }

        M.diff_recursive(base.data, other.data, "", peer_diff.paths)

        if #peer_diff.paths > 0 then
            table.insert(diffs, peer_diff)
        end
    end

    return diffs
end

-- Recursive diff finder
function M.diff_recursive(a, b, path, diffs)
    local type_a = type(a)
    local type_b = type(b)

    if type_a ~= type_b then
        table.insert(diffs, {
            path = path,
            type = "type_mismatch",
            a = type_a,
            b = type_b
        })
        return
    end

    if type_a ~= "table" then
        if a ~= b then
            table.insert(diffs, {
                path = path,
                type = "value_mismatch",
                a = a,
                b = b
            })
        end
        return
    end

    -- Gather all keys
    local all_keys = {}
    for k in pairs(a) do all_keys[k] = true end
    for k in pairs(b) do all_keys[k] = true end

    for k in pairs(all_keys) do
        local new_path = path == "" and tostring(k) or (path .. "." .. tostring(k))
        if a[k] == nil then
            table.insert(diffs, {
                path = new_path,
                type = "missing_in_a",
                b = b[k]
            })
        elseif b[k] == nil then
            table.insert(diffs, {
                path = new_path,
                type = "missing_in_b",
                a = a[k]
            })
        else
            M.diff_recursive(a[k], b[k], new_path, diffs)
        end
    end
end

-- Persistence: save to file
function M.save(path)
    local f = io.open(path, "w")
    if not f then return nil, "cannot open file" end
    f:write(json.encode(M.records, { indent = true }))
    f:close()
    return true
end

-- Persistence: load from file
function M.load(path)
    local f = io.open(path, "r")
    if not f then return nil, "cannot open file" end
    local content = f:read("*a")
    f:close()
    local data, _, err = json.decode(content)
    if err then return nil, err end
    M.records = data or {}
    return true
end

-- Clear records
function M.clear()
    M.records = {}
end

return M
