// types.ts - Profile JSON schema for behavior state machines
//
// A profile defines a state machine where each state runs a registered behavior
// and transitions fire based on game conditions (timer, inventory, health, etc.).
// States can define typed input/output ports for passing data between states
// via independent data connections.

// Port value types determine color and compatibility
export type PortValueType = 'player' | 'number' | 'item' | 'location' | 'text';

export const PORT_TYPE_COLORS: Record<PortValueType, string> = {
    player:   '#2ecc71',  // green
    number:   '#4a9eff',  // blue
    item:     '#e67e22',  // orange
    location: '#9b59b6',  // purple
    text:     '#999999',  // gray
};

export interface PortDefinition {
    id: string;
    name: string;              // Display label, e.g. "target", "count"
    valueType: PortValueType;
    side: 'input' | 'output';
}

// A data connection between an output port and an input port (independent of transitions)
export interface DataConnection {
    id: string;
    fromStateId: string;
    fromPortId: string;
    toStateId: string;
    toPortId: string;
}

// Maps a behavior param to read its value from an input port instead of hardcoded
export interface ParamBinding {
    paramName: string;
    portId: string;            // References an input port on the same state
}

export interface BehaviorProfile {
    id: string;
    name: string;
    description: string;
    version: 1;
    createdAt: string;       // ISO 8601
    updatedAt: string;
    initialStateId: string;
    states: ProfileState[];
    transitions: ProfileTransition[];
    dataConnections?: DataConnection[];
    editorMeta: { canvasOffsetX: number; canvasOffsetY: number; zoom: number };
}

export interface ProfileState {
    id: string;
    name: string;                              // Display name, e.g. "Chop Trees"
    behaviorName: string;                      // Registry key: 'idle', 'wander', etc.
    behaviorParams: Record<string, any>;       // Passed to behavior factory
    interruptHandlers: InterruptHandler[];
    ports?: PortDefinition[];                  // Typed data ports
    paramBindings?: ParamBinding[];            // Param -> input port bindings
    x: number; y: number;                      // Canvas position
    color?: string;
}

export interface InterruptHandler {
    interruptType: 'dm' | 'nearby_chat' | 'combat' | 'player_interaction' | 'low_health' | 'timer_complete';
    action: 'transition' | 'pause' | 'ignore';
    targetStateId?: string;                    // Required when action === 'transition'
}

export interface ProfileTransition {
    id: string;
    fromStateId: string;
    toStateId: string;
    condition: TransitionCondition;
    priority: number;                          // Higher = evaluated first
    label?: string;
}

export type TransitionCondition =
    | { type: 'behavior_complete' }
    | { type: 'timer'; durationMs: number }
    | { type: 'inventory_percent_full'; operator: '>=' | '<'; value: number }
    | { type: 'health_percent'; operator: '>=' | '<' | '<='; value: number }
    | { type: 'item_count'; itemPattern: string; operator: '>=' | '<' | '=='; value: number }
    | { type: 'skill_level'; skillName: string; operator: '>=' | '<'; value: number }
    | { type: 'always' };

// Interrupt type names for the editor UI
export const INTERRUPT_TYPES = [
    'dm', 'nearby_chat', 'combat', 'player_interaction', 'low_health', 'timer_complete'
] as const;

export type InterruptType = typeof INTERRUPT_TYPES[number];

// Available behaviors metadata for the editor
export interface BehaviorInfo {
    name: string;
    description: string;
    params: BehaviorParamInfo[];
}

export interface BehaviorParamInfo {
    name: string;
    type: 'number' | 'string' | 'boolean';
    default: any;
    description: string;
    portType?: PortValueType;  // Suggests which port type this param naturally maps to
}
