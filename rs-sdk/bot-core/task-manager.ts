// task-manager.ts - Priority-based task list with interrupt handling
//
// The task manager maintains a list of tasks sorted by priority.
// Tasks can be paused (creating resume tasks) and interrupted.
// The LLM doesn't drive the bot - the bot drives the LLM via task completion events.
//
// Lua port note: This would use a simple table with insert/remove.
// Priority sorting can use table.sort with a comparator function.

export type TaskStatus = 'pending' | 'running' | 'paused' | 'completed';
export type TaskType = 'behavior' | 'respond' | 'resume' | 'idle' | 'decision' | 'timer_complete';

/**
 * Timer attached to a task.
 * When the timer expires, it triggers a timer_complete interrupt.
 */
export interface TaskTimer {
    taskId: string;
    durationMs: number;
    startedAt: number;
    requestedBy?: string;  // Who asked for this timed task
    completionMessage?: string;  // Custom message when timer fires
}

/**
 * Personality traits that influence bot decisions.
 * STUB: This will be expanded when personality system is designed.
 */
export interface PersonalityTraits {
    // Social traits
    sociability: number;      // 0-1: How much the bot wants to hang out with others
    independence: number;     // 0-1: How likely to go off and do own thing
    helpfulness: number;      // 0-1: How eager to help when asked

    // Work traits
    diligence: number;        // 0-1: How focused on tasks
    adventurousness: number;  // 0-1: How likely to explore/try new things

    // Communication style
    verbosity: number;        // 0-1: How much they talk
    formality: number;        // 0-1: Formal vs casual speech
}

/**
 * Default personality for bots without custom traits.
 */
export const DEFAULT_PERSONALITY: PersonalityTraits = {
    sociability: 0.5,
    independence: 0.5,
    helpfulness: 0.7,
    diligence: 0.5,
    adventurousness: 0.5,
    verbosity: 0.5,
    formality: 0.3,
};

/**
 * A task in the bot's task list.
 * Tasks are processed by priority (higher = more urgent).
 */
export interface Task {
    id: string;
    type: TaskType;
    priority: number;
    status: TaskStatus;

    // Behavior tasks
    behaviorName?: string;
    behaviorState?: any;  // Serializable state for resume

    // Response tasks (DM/chat)
    messageFrom?: string;
    messageContent?: string;
    messageType?: 'dm' | 'nearby' | 'system';

    // Resume tasks
    resumeTaskId?: string;

    // Decision tasks (need LLM input)
    decisionContext?: string;

    // Timer-related fields
    timer?: TaskTimer;       // Active timer on this task
    requestedBy?: string;    // Who requested this task (for notifications)

    // Timer completion tasks (type: 'timer_complete')
    completedTaskId?: string;     // The task that was interrupted by timer
    completedBehavior?: string;   // What behavior was running
    timerResults?: any;           // Results/stats from the timed activity

    createdAt: number;
    pausedAt?: number;
}

/**
 * Interrupt types that can pause the current task.
 * Higher priority interrupts override lower ones.
 */
export interface Interrupt {
    type: 'dm' | 'nearby_chat' | 'combat' | 'player_interaction' | 'low_health' | 'timer_complete';
    priority: number;
    data: any;
}

// Default interrupt priorities
// Lua port note: These would be constants at module scope
export const INTERRUPT_PRIORITIES: Record<Interrupt['type'], number> = {
    low_health: 100,
    combat: 90,
    dm: 80,
    timer_complete: 70,  // Timer expiration - important but not urgent
    player_interaction: 60,
    nearby_chat: 30,
};

// Default task priorities
export const TASK_PRIORITIES = {
    CRITICAL: 100,
    HIGH: 80,
    NORMAL: 50,
    LOW: 20,
    IDLE: 10,
};

let taskIdCounter = 0;
function generateTaskId(): string {
    return `task_${Date.now()}_${taskIdCounter++}`;
}

/**
 * Task manager maintains the bot's task list.
 *
 * Usage:
 *   const tm = new TaskManager();
 *   tm.addTask({ type: 'idle', priority: 10 });
 *
 *   // Main loop
 *   while (true) {
 *       const task = tm.getHighestPriority();
 *       if (!task) continue;
 *       // Execute task...
 *   }
 *
 * Lua port note: This class translates to a table with methods:
 *   local TaskManager = {}
 *   TaskManager.__index = TaskManager
 *   function TaskManager:new() ... end
 */
export class TaskManager {
    private tasks: Map<string, Task> = new Map();
    private currentTaskId: string | null = null;

    // Personality traits for decision-making
    // STUB: Will be loaded from personality table when designed
    personality: PersonalityTraits = { ...DEFAULT_PERSONALITY };

    // Event callbacks
    // Lua port note: These would be simple function fields set with manager.onTaskComplete = function(task) ... end
    onTaskComplete?: (task: Task) => void;
    onTaskPaused?: (task: Task, reason: string) => void;
    onInterrupt?: (interrupt: Interrupt, pausedTask: Task | null) => void;
    onTimerComplete?: (task: Task, timer: TaskTimer, results: any) => void;

    /**
     * Add a new task to the list.
     * Returns the created task with generated ID and timestamp.
     */
    addTask(taskData: Omit<Task, 'id' | 'createdAt' | 'status'> & { status?: TaskStatus }): Task {
        const task: Task = {
            ...taskData,
            id: generateTaskId(),
            status: taskData.status ?? 'pending',
            createdAt: Date.now(),
        };
        this.tasks.set(task.id, task);
        return task;
    }

    /**
     * Get task by ID.
     */
    getTask(id: string): Task | undefined {
        return this.tasks.get(id);
    }

    /**
     * Get the highest priority task that's ready to run.
     * Returns pending tasks first, then running tasks.
     */
    getHighestPriority(): Task | null {
        let best: Task | null = null;

        for (const task of this.tasks.values()) {
            // Skip completed or paused tasks
            if (task.status === 'completed' || task.status === 'paused') {
                continue;
            }

            if (!best || task.priority > best.priority) {
                best = task;
            } else if (task.priority === best.priority) {
                // Same priority: prefer pending over running, older over newer
                if (task.status === 'pending' && best.status === 'running') {
                    best = task;
                } else if (task.status === best.status && task.createdAt < best.createdAt) {
                    best = task;
                }
            }
        }

        return best;
    }

    /**
     * Get the currently running task.
     */
    getCurrentTask(): Task | null {
        if (!this.currentTaskId) return null;
        const task = this.tasks.get(this.currentTaskId);
        return task?.status === 'running' ? task : null;
    }

    /**
     * Start executing a task.
     * Updates status to 'running' and tracks as current.
     */
    startTask(taskId: string): Task | null {
        const task = this.tasks.get(taskId);
        if (!task || task.status !== 'pending') {
            return null;
        }

        task.status = 'running';
        this.currentTaskId = taskId;
        return task;
    }

    /**
     * Mark a task as completed.
     * Triggers onTaskComplete callback.
     */
    completeTask(taskId: string): void {
        const task = this.tasks.get(taskId);
        if (!task) return;

        task.status = 'completed';

        if (this.currentTaskId === taskId) {
            this.currentTaskId = null;
        }

        this.onTaskComplete?.(task);

        // Clean up completed tasks after a delay (keep for debugging)
        // Lua port note: Use a simple counter check, not setTimeout
        setTimeout(() => {
            if (task.status === 'completed') {
                this.tasks.delete(taskId);
            }
        }, 10000);
    }

    /**
     * Pause a task and optionally create a resume task.
     * Saves the current state for later resumption.
     * Returns the created resume task if createResume is true.
     */
    pauseTask(taskId: string, state: any, reason: string, createResume: boolean = true): Task | null {
        const task = this.tasks.get(taskId);
        if (!task || task.status !== 'running') {
            return null;
        }

        task.status = 'paused';
        task.behaviorState = state;
        task.pausedAt = Date.now();

        if (this.currentTaskId === taskId) {
            this.currentTaskId = null;
        }

        this.onTaskPaused?.(task, reason);

        // Create a resume task at same priority (can be adjusted later by LLM)
        if (createResume) {
            return this.addTask({
                type: 'resume',
                priority: task.priority,
                resumeTaskId: taskId,
            });
        }

        return null;
    }

    /**
     * Resume a paused task.
     * The resume task should be completed after calling this.
     */
    resumeTask(pausedTaskId: string): Task | null {
        const task = this.tasks.get(pausedTaskId);
        if (!task || task.status !== 'paused') {
            return null;
        }

        task.status = 'pending';
        delete task.pausedAt;
        return task;
    }

    /**
     * Handle an interrupt.
     * If there's a running task with lower priority than the interrupt,
     * pause it and create a response task for the interrupt.
     */
    handleInterrupt(interrupt: Interrupt): Task | null {
        const current = this.getCurrentTask();

        // Check if we should interrupt
        if (current && current.priority >= interrupt.priority) {
            // Current task has higher or equal priority, don't interrupt
            return null;
        }

        // Pause current task if running
        if (current) {
            this.pauseTask(current.id, current.behaviorState, `interrupt:${interrupt.type}`);
        }

        this.onInterrupt?.(interrupt, current);

        // Create appropriate response task
        if (interrupt.type === 'dm' || interrupt.type === 'nearby_chat') {
            return this.addTask({
                type: 'respond',
                priority: interrupt.priority,
                messageFrom: interrupt.data.from,
                messageContent: interrupt.data.content,
                messageType: interrupt.type === 'dm' ? 'dm' : 'nearby',
            });
        } else if (interrupt.type === 'combat' || interrupt.type === 'low_health') {
            return this.addTask({
                type: 'decision',
                priority: interrupt.priority,
                decisionContext: `${interrupt.type}: ${JSON.stringify(interrupt.data)}`,
            });
        } else if (interrupt.type === 'timer_complete') {
            // Timer completion creates a special task for notifying and deciding next action
            return this.addTask({
                type: 'timer_complete',
                priority: interrupt.priority,
                completedTaskId: interrupt.data.taskId,
                completedBehavior: interrupt.data.behavior,
                requestedBy: interrupt.data.requestedBy,
                timerResults: interrupt.data.results,
                decisionContext: interrupt.data.message || 'Timer completed',
            });
        }

        return null;
    }

    /**
     * Get all tasks (for providing context to LLM).
     */
    getAllTasks(): Task[] {
        return Array.from(this.tasks.values())
            .filter(t => t.status !== 'completed')
            .sort((a, b) => b.priority - a.priority);
    }

    /**
     * Get tasks formatted for LLM context.
     */
    getTaskListForLLM(): string {
        const tasks = this.getAllTasks();
        if (tasks.length === 0) {
            return 'Task list is empty.';
        }

        const lines = ['Current task list (highest priority first):'];
        const now = Date.now();

        for (const task of tasks) {
            const status = task.status === 'running' ? '[RUNNING]'
                         : task.status === 'paused' ? '[PAUSED]'
                         : task.status === 'pending' ? '[PENDING]'
                         : '[?]';

            let desc = `${task.type}`;
            if (task.behaviorName) desc += `: ${task.behaviorName}`;
            if (task.messageFrom) desc += ` from ${task.messageFrom}`;
            if (task.resumeTaskId) desc += ` (resume)`;
            if (task.requestedBy) desc += ` (for ${task.requestedBy})`;

            // Add timer info if present
            if (task.timer) {
                const elapsed = now - task.timer.startedAt;
                const remaining = Math.max(0, task.timer.durationMs - elapsed);
                const mins = Math.floor(remaining / 60000);
                const secs = Math.floor((remaining % 60000) / 1000);
                const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
                desc += ` [timer: ${timeStr} left]`;
            }

            // Timer completion info
            if (task.type === 'timer_complete') {
                desc = `timer_complete: ${task.completedBehavior || 'task'}`;
                if (task.requestedBy) desc += ` (notify ${task.requestedBy})`;
            }

            lines.push(`  ${status} [P${task.priority}] ${desc} (id: ${task.id})`);
        }

        // Add timer summary
        const timerStatus = this.getTimerStatusForLLM();
        if (timerStatus) {
            lines.push('');
            lines.push(timerStatus);
        }

        return lines.join('\n');
    }

    /**
     * Update a task's priority.
     * Used by LLM to reprioritize after circumstances change.
     */
    setPriority(taskId: string, priority: number): void {
        const task = this.tasks.get(taskId);
        if (task) {
            task.priority = priority;
        }
    }

    /**
     * Remove a task from the list.
     */
    removeTask(taskId: string): void {
        this.tasks.delete(taskId);
        if (this.currentTaskId === taskId) {
            this.currentTaskId = null;
        }
    }

    /**
     * Clear all tasks.
     */
    clear(): void {
        this.tasks.clear();
        this.currentTaskId = null;
    }

    // ========== TIMER MANAGEMENT ==========

    /**
     * Add a timer to a task.
     * When the timer expires, the task will be interrupted.
     *
     * @param taskId - The task to attach the timer to
     * @param durationMs - How long the timer should run (milliseconds)
     * @param requestedBy - Who asked for this timed task (for notifications)
     * @param completionMessage - Custom message when timer fires
     *
     * Example: "mine silver for 10 minutes" →
     *   addTimer(taskId, 10 * 60 * 1000, 'player123', 'Mining timer complete')
     */
    addTimer(
        taskId: string,
        durationMs: number,
        requestedBy?: string,
        completionMessage?: string
    ): TaskTimer | null {
        const task = this.tasks.get(taskId);
        if (!task) return null;

        const timer: TaskTimer = {
            taskId,
            durationMs,
            startedAt: Date.now(),
            requestedBy,
            completionMessage,
        };

        task.timer = timer;
        task.requestedBy = requestedBy;

        return timer;
    }

    /**
     * Cancel a timer on a task.
     */
    cancelTimer(taskId: string): boolean {
        const task = this.tasks.get(taskId);
        if (!task || !task.timer) return false;

        delete task.timer;
        return true;
    }

    /**
     * Get remaining time on a task's timer.
     * Returns null if no timer, 0 if expired.
     */
    getTimerRemaining(taskId: string): number | null {
        const task = this.tasks.get(taskId);
        if (!task || !task.timer) return null;

        const elapsed = Date.now() - task.timer.startedAt;
        const remaining = task.timer.durationMs - elapsed;
        return Math.max(0, remaining);
    }

    /**
     * Check all timers and fire interrupts for expired ones.
     * Call this regularly from the main loop (e.g., every tick).
     *
     * @param resultsCollector - Optional function to gather results from timed task
     * @returns Array of fired timer_complete tasks
     */
    tick(resultsCollector?: (task: Task) => any): Task[] {
        const firedTasks: Task[] = [];
        const now = Date.now();

        for (const task of this.tasks.values()) {
            if (!task.timer) continue;
            if (task.status === 'completed' || task.status === 'paused') continue;

            const elapsed = now - task.timer.startedAt;
            if (elapsed >= task.timer.durationMs) {
                // Timer expired!
                const timer = task.timer;
                const results = resultsCollector?.(task);

                // Fire the timer_complete interrupt
                const completionTask = this.handleTimerComplete(task, timer, results);
                if (completionTask) {
                    firedTasks.push(completionTask);
                }

                this.onTimerComplete?.(task, timer, results);
            }
        }

        return firedTasks;
    }

    /**
     * Handle a timer completion - pause the task and create notification task.
     * @internal
     */
    private handleTimerComplete(task: Task, timer: TaskTimer, results?: any): Task | null {
        // Pause the timed task
        if (task.status === 'running') {
            this.pauseTask(task.id, task.behaviorState, 'timer_complete', false);
        }

        // Remove the timer
        delete task.timer;

        // Create a timer_complete task for LLM to handle notification
        return this.addTask({
            type: 'timer_complete',
            priority: INTERRUPT_PRIORITIES.timer_complete,
            completedTaskId: task.id,
            completedBehavior: task.behaviorName,
            requestedBy: timer.requestedBy,
            timerResults: results,
            decisionContext: timer.completionMessage || `Timer expired for ${task.behaviorName || 'task'}`,
        });
    }

    /**
     * Get all active timers with their status.
     * Useful for LLM context.
     */
    getActiveTimers(): Array<{ task: Task; remaining: number; requestedBy?: string }> {
        const timers: Array<{ task: Task; remaining: number; requestedBy?: string }> = [];
        const now = Date.now();

        for (const task of this.tasks.values()) {
            if (!task.timer) continue;
            if (task.status === 'completed') continue;

            const elapsed = now - task.timer.startedAt;
            const remaining = Math.max(0, task.timer.durationMs - elapsed);

            timers.push({
                task,
                remaining,
                requestedBy: task.timer.requestedBy,
            });
        }

        return timers;
    }

    /**
     * Format active timers for LLM context.
     */
    getTimerStatusForLLM(): string {
        const timers = this.getActiveTimers();
        if (timers.length === 0) return '';

        const lines = ['Active timers:'];
        for (const { task, remaining, requestedBy } of timers) {
            const mins = Math.floor(remaining / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);
            const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
            const forStr = requestedBy ? ` (for ${requestedBy})` : '';
            lines.push(`  - ${task.behaviorName || task.type}: ${timeStr} remaining${forStr}`);
        }
        return lines.join('\n');
    }

    // ========== PERSONALITY HELPERS (STUBS) ==========

    /**
     * Get what the bot should do after a timed task completes.
     * STUB: This will be expanded with personality system.
     *
     * Returns a suggested action based on personality traits.
     */
    getPostTimerDecision(completedTask: Task, requestedBy?: string): {
        action: 'return_to_requester' | 'continue_task' | 'do_own_thing' | 'idle';
        message?: string;
    } {
        const p = this.personality;

        // High sociability + request from someone → return to them
        if (requestedBy && p.sociability > 0.6) {
            return {
                action: 'return_to_requester',
                message: `I should go back to ${requestedBy} and let them know I'm done.`,
            };
        }

        // High independence → go do own thing
        if (p.independence > 0.7 && p.adventurousness > 0.5) {
            return {
                action: 'do_own_thing',
                message: 'Time to do my own thing for a while.',
            };
        }

        // High diligence → offer to continue
        if (p.diligence > 0.7) {
            return {
                action: 'continue_task',
                message: 'I could keep going if needed.',
            };
        }

        // Default: return to requester if there is one
        if (requestedBy) {
            return {
                action: 'return_to_requester',
                message: `I'll let ${requestedBy} know I'm finished.`,
            };
        }

        return {
            action: 'idle',
            message: 'Taking a break.',
        };
    }

    /**
     * Generate a completion notification message based on personality.
     * STUB: Will use personality for tone/verbosity.
     */
    generateTimerCompleteMessage(
        behavior: string | undefined,
        duration: number,
        results: any,
        requestedBy?: string
    ): string {
        const p = this.personality;
        const mins = Math.round(duration / 60000);

        // STUB: Basic message generation
        // TODO: Use personality.verbosity and formality for tone
        let msg = '';

        if (results && typeof results === 'object') {
            // Try to extract useful info from results
            if (results.count !== undefined) {
                msg = `It's been ${mins} minutes and I ${behavior || 'worked'} ${results.count} items.`;
            } else if (results.summary) {
                msg = `It's been ${mins} minutes. ${results.summary}`;
            } else {
                msg = `It's been ${mins} minutes. I finished ${behavior || 'the task'}.`;
            }
        } else {
            msg = `Hey, it's been ${mins} minutes. I'm done ${behavior || 'with that'}.`;
        }

        // Add what we're doing next based on personality
        const decision = this.getPostTimerDecision({ behaviorName: behavior } as Task, requestedBy);
        if (p.verbosity > 0.5 && decision.message) {
            msg += ' ' + decision.message;
        }

        return msg;
    }

    /**
     * Set personality traits.
     * STUB: Will be replaced with proper personality loading.
     */
    setPersonality(traits: Partial<PersonalityTraits>): void {
        this.personality = { ...this.personality, ...traits };
    }
}

// Factory function for cleaner API
export function createTaskManager(): TaskManager {
    return new TaskManager();
}
