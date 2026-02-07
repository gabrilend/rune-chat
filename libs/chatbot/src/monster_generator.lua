-- Monster Generator Script
local dkjson = require('libs.dkjson')

-- Seed random number generator for reproducibility across runs
math.randomseed(os.time())

-- Base monster templates
local base_monsters = {
  {type = "Goblin",   hp = 30, attack = 8, defense = 2},
  {type = "Orc",      hp = 45, attack = 12, defense = 4},
  {type = "Skeleton", hp = 35, attack = 9, defense = 3}
}

-- Generate a random monster from a base template
local function generate_monster(base)
  local variation = {"Minor", "Greater", "Elder"}
  local name_suffix = variation[math.random(#variation)]

  local factor = 0.8 + math.random() * 0.4 -- +/-20% variation
  return {
    name = base.type .. " " .. name_suffix,
    hp   = math.max(1, math.floor(base.hp * factor) + math.random(-5, 5)),
    attack = math.max(1, math.floor(base.attack * factor) + math.random(-5, 5)),
    defense = math.max(1, math.floor(base.defense * factor) + math.random(-5, 5)),
    level = math.random(1, 20)
  }
end

-- Create a list of random monsters
local function generate_monsters(count)
  local monsters = {}
  for i = 1, count do
    monsters[i] = generate_monster(base_monsters[math.random(#base_monsters)])
  end
  return monsters
end

-- Encode to pretty JSON
local function monsters_to_json(monsters)
  return dkjson.encode(monsters, {indent = true})
end

-- Run the script
local monster_count = 10
local monsters = generate_monsters(monster_count)
print("Generated Monsters (JSON):")
print(monsters_to_json(monsters))