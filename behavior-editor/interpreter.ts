// interpreter.ts - Runtime interpreter for behavior profiles
//
// Loads a BehaviorProfile JSON and returns a BehaviorDefinition that executes
// the state machine: running sub-behaviors, evaluating transitions, handling
// interrupts per the profile's configuration.

import type { BehaviorDefinition, BehaviorContext } from '../rs-sdk/bot-core/behavior-executor';
import type { BotWorldState } from '../rs-sdk/sdk/types';
import type { Interrupt } from '../rs-sdk/bot-core/task-manager';
import type { BehaviorProfile, ProfileState, ProfileTransition, TransitionCondition, InterruptHandler } from './types';

interface StateMachineState {
    currentStateId: string;
    stateEnteredAt: number;
    ticksInState: number;
    subBehaviorComplete: boolean;
    subBehaviorState: any;
    timerStartedAt: Record<string, number>; // transitionId -> Date.now() when state was entered
    portValues: Record<string, any>;        // portId -> current value (persists across transitions)
}

/**
 * Create a BehaviorDefinition that runs a profile as a state machine.
 *
 * @param profile - The behavior profile to execute
 * @param getBehavior - Lookup function for resolving behavior names to definitions
 */
export function createProfileBehavior(
    profile: BehaviorProfile,
    getBehavior: (name: string, params?: Record<string, any>) => BehaviorDefinition | undefined
): BehaviorDefinition {
    return {
        name: `profile:${profile.name}`,
        description: `State machine: ${profile.description || profile.name}`,
        fn: async (ctx: BehaviorContext) => {
            // Restore or initialize state machine state
            const sm: StateMachineState = ctx.getResumeState() ?? {
                currentStateId: profile.initialStateId,
                stateEnteredAt: Date.now(),
                ticksInState: 0,
                subBehaviorComplete: false,
                subBehaviorState: null,
                timerStartedAt: {},
                portValues: {},
            };

            if (!sm.currentStateId) {
                ctx.log(`[profile:${profile.name}] No initial state configured`);
                return;
            }

            ctx.log(`[profile:${profile.name}] Starting in state: ${getStateName(profile, sm.currentStateId)}`);

            while (true) {
                const currentState = profile.states.find(s => s.id === sm.currentStateId);
                if (!currentState) {
                    ctx.log(`[profile:${profile.name}] State not found: ${sm.currentStateId}`);
                    return;
                }

                // 1. Check for interrupts and handle per state config
                const interrupt = ctx.checkInterrupt();
                if (interrupt) {
                    const handler = findInterruptHandler(currentState, interrupt.type);
                    if (handler) {
                        if (handler.action === 'transition' && handler.targetStateId) {
                            ctx.log(`[profile:${profile.name}] Interrupt ${interrupt.type} -> transition to ${getStateName(profile, handler.targetStateId)}`);
                            transitionTo(sm, handler.targetStateId);
                            continue;
                        } else if (handler.action === 'pause') {
                            ctx.log(`[profile:${profile.name}] Interrupt ${interrupt.type} -> pausing`);
                            ctx.pauseWithState(sm);
                            return;
                        }
                        // 'ignore' - fall through
                    } else {
                        // No handler configured - default to pausing
                        ctx.log(`[profile:${profile.name}] Interrupt ${interrupt.type} -> pausing (no handler)`);
                        ctx.pauseWithState(sm);
                        return;
                    }
                }

                // 2. Evaluate outgoing transitions (sorted by priority)
                const transitions = getOutgoingTransitions(profile, sm.currentStateId);
                const gameState = ctx.sdk.getState();
                let transitioned = false;

                for (const trans of transitions) {
                    if (evaluateCondition(trans.condition, gameState, sm)) {
                        ctx.log(`[profile:${profile.name}] Transition: ${getStateName(profile, trans.fromStateId)} -> ${getStateName(profile, trans.toStateId)} (${conditionLabel(trans.condition)})`);
                        transitionTo(sm, trans.toStateId);
                        transitioned = true;
                        break;
                    }
                }

                if (transitioned) continue;

                // 3. Run the current state's sub-behavior (one tick)
                if (!sm.subBehaviorComplete) {
                    // Resolve param bindings: override hardcoded params with input port values
                    const effectiveParams = resolveParamBindings(profile, currentState, sm);
                    const subBehavior = getBehavior(currentState.behaviorName, effectiveParams);
                    if (subBehavior) {
                        // Create a wrapped context for the sub-behavior
                        const subCtx = createSubContext(ctx, sm, currentState);
                        try {
                            await subBehavior.fn(subCtx);
                            // If the sub-behavior returned without pausing, it completed
                            if (!subCtx._paused) {
                                sm.subBehaviorComplete = true;
                                sm.subBehaviorState = null;
                                ctx.log(`[profile:${profile.name}] Sub-behavior '${currentState.behaviorName}' completed in state '${currentState.name}'`);
                            }
                        } catch (e) {
                            ctx.log(`[profile:${profile.name}] Sub-behavior error: ${e}`);
                            sm.subBehaviorComplete = true;
                        }
                    } else {
                        // Unknown behavior - wait a tick
                        const continued = await ctx.waitTicks(5);
                        if (!continued) {
                            ctx.pauseWithState(sm);
                            return;
                        }
                    }
                } else {
                    // Sub-behavior already completed, just wait for transitions
                    const continued = await ctx.waitTicks(3);
                    if (!continued) {
                        ctx.pauseWithState(sm);
                        return;
                    }
                }

                sm.ticksInState++;
            }
        },
    };
}

function transitionTo(sm: StateMachineState, targetStateId: string) {
    sm.currentStateId = targetStateId;
    sm.stateEnteredAt = Date.now();
    sm.ticksInState = 0;
    sm.subBehaviorComplete = false;
    sm.subBehaviorState = null;
    sm.timerStartedAt = {};
}

function getStateName(profile: BehaviorProfile, stateId: string): string {
    return profile.states.find(s => s.id === stateId)?.name || stateId.slice(0, 8);
}

function getOutgoingTransitions(profile: BehaviorProfile, stateId: string): ProfileTransition[] {
    return profile.transitions
        .filter(t => t.fromStateId === stateId)
        .sort((a, b) => b.priority - a.priority);
}

function findInterruptHandler(state: ProfileState, interruptType: string): InterruptHandler | undefined {
    return state.interruptHandlers?.find(h =>
        h.interruptType === interruptType && h.action !== 'ignore'
    );
}

/**
 * Evaluate a transition condition against the current game state.
 */
function evaluateCondition(
    condition: TransitionCondition,
    gameState: BotWorldState | null,
    sm: StateMachineState
): boolean {
    if (!condition) return false;

    switch (condition.type) {
        case 'behavior_complete':
            return sm.subBehaviorComplete;

        case 'always':
            return true;

        case 'timer': {
            const elapsed = Date.now() - sm.stateEnteredAt;
            return elapsed >= condition.durationMs;
        }

        case 'inventory_percent_full': {
            if (!gameState) return false;
            const filledSlots = gameState.inventory?.length || 0;
            const pct = (filledSlots / 28) * 100;
            return compareOp(pct, condition.operator, condition.value);
        }

        case 'health_percent': {
            if (!gameState?.skills) return false;
            const hp = gameState.skills.find(s => s.name === 'Hitpoints' || s.name === 'hitpoints');
            if (!hp) return false;
            const pct = (hp.level / hp.baseLevel) * 100;
            return compareOp(pct, condition.operator, condition.value);
        }

        case 'item_count': {
            if (!gameState?.inventory) return false;
            const pattern = condition.itemPattern.toLowerCase();
            const count = gameState.inventory.filter(item =>
                item.name.toLowerCase().includes(pattern)
            ).reduce((sum, item) => sum + item.count, 0);
            return compareOp(count, condition.operator, condition.value);
        }

        case 'skill_level': {
            if (!gameState?.skills) return false;
            const skill = gameState.skills.find(s =>
                s.name.toLowerCase() === condition.skillName.toLowerCase()
            );
            if (!skill) return false;
            return compareOp(skill.level, condition.operator, condition.value);
        }

        default:
            return false;
    }
}

function compareOp(actual: number, operator: string, expected: number): boolean {
    switch (operator) {
        case '>=': return actual >= expected;
        case '<': return actual < expected;
        case '<=': return actual <= expected;
        case '==': return actual === expected;
        default: return false;
    }
}

function conditionLabel(condition: TransitionCondition): string {
    switch (condition.type) {
        case 'behavior_complete': return 'complete';
        case 'timer': return `${condition.durationMs}ms`;
        case 'inventory_percent_full': return `inv ${condition.operator} ${condition.value}%`;
        case 'health_percent': return `hp ${condition.operator} ${condition.value}%`;
        case 'item_count': return `${condition.itemPattern} ${condition.operator} ${condition.value}`;
        case 'skill_level': return `${condition.skillName} ${condition.operator} ${condition.value}`;
        case 'always': return 'always';
        default: return '?';
    }
}

/**
 * Resolve param bindings: for each ParamBinding, look up the input port's
 * connected value from portValues and override the hardcoded param.
 */
function resolveParamBindings(
    profile: BehaviorProfile,
    state: ProfileState,
    sm: StateMachineState
): Record<string, any> {
    const effectiveParams = { ...state.behaviorParams };
    const bindings = state.paramBindings || [];
    const connections = profile.dataConnections || [];

    for (const binding of bindings) {
        // Find the input port this binding references
        const inputPort = (state.ports || []).find(p => p.id === binding.portId);
        if (!inputPort) continue;

        // Find the data connection feeding this input port
        const conn = connections.find(
            c => c.toStateId === state.id && c.toPortId === binding.portId
        );
        if (conn && sm.portValues[conn.fromPortId] !== undefined) {
            effectiveParams[binding.paramName] = sm.portValues[conn.fromPortId];
        }
        // If no connection or no value yet, keep the hardcoded default
    }

    return effectiveParams;
}

interface SubBehaviorContext extends BehaviorContext {
    _paused: boolean;
}

/**
 * Create a wrapped BehaviorContext for a sub-behavior.
 * Tracks whether the sub-behavior paused (vs completed normally).
 * Provides setPortValue for writing to output ports.
 */
function createSubContext(
    parentCtx: BehaviorContext,
    sm: StateMachineState,
    currentState: ProfileState
): SubBehaviorContext {
    const subCtx: SubBehaviorContext = {
        sdk: parentCtx.sdk,
        bot: parentCtx.bot,
        log: parentCtx.log,
        taskManager: parentCtx.taskManager,
        currentTask: parentCtx.currentTask,
        locationMemory: parentCtx.locationMemory,
        itemMemory: parentCtx.itemMemory,
        _paused: false,

        checkInterrupt: () => {
            return parentCtx.checkInterrupt();
        },

        pauseWithState: (state: any) => {
            subCtx._paused = true;
            sm.subBehaviorState = state;
            parentCtx.pauseWithState(sm);
        },

        getResumeState: () => {
            return sm.subBehaviorState;
        },

        waitTicks: async (ticks: number): Promise<boolean> => {
            return parentCtx.waitTicks(ticks);
        },

        setPortValue: (portName: string, value: any) => {
            const port = (currentState.ports || []).find(
                p => p.side === 'output' && p.name === portName
            );
            if (port) {
                sm.portValues[port.id] = value;
            }
        },
    };

    return subCtx;
}
