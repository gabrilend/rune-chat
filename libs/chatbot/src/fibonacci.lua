--[[
    fibonacci.lua
    Prints the largest Fibonacci number that is strictly less than a given limit.

    Usage:
        lua fibonacci.lua <limit>

    The script reads the first command-line argument as the numeric limit,
    generates Fibonacci numbers until the next value would reach or exceed
    the limit, and then outputs the last valid Fibonacci number.
--]]

local limit_str = arg[1]
if not limit_str or limit_str:match("[^0-9]") then
    io.stderr:write("Usage: lua ", arg[0], " <positive_number>\\n")
    os.exit(1)
end

local limit = tonumber(limit_str)

-- Guard against non-positive limits.
if limit <= 0 then
    io.stderr:write("Limit must be a positive number.\\n")
    os.exit(1)
end

-- Initialize two consecutive Fibonacci numbers.
local prev, cur = 0, 1

-- Generate while the next number would still be below the limit.
while true do
    local next_val = prev + cur   -- Compute the following Fibonacci number.
    if next_val >= limit then      -- Stop when reaching or exceeding the limit.
        break
    end
    -- Shift the pair forward: new 'prev' becomes old 'cur', new 'cur' becomes 'next_val'.
    prev, cur = cur, next_val
end

-- At this point 'cur' holds the largest Fibonacci number < limit.
print(cur)