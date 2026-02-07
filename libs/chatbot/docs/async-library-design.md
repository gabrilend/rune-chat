here's the design for the async library.

it will use a threadpool and iterate through each of the tasks required to be done. They will all
share memory, and they will be written in C with pthreads. A task can be added to the threadpool's
task list by any of the worker threads, or external programs. It will automatically use as many
threads as are defined in a config file which is stored in the project directory at config/config.
This file will be formatted like this:

option=abcd1234

the threadpool will take in two values when creating a task. The first value is a pointer to the
function to be performed, and the second value is a void pointer to the location of the arguments
to that function. The thread pool, when a task is launched, will extract the arguments from the
void pointer and provide them to the function when it's called in the worker thread. Each function
will know how to construct the function call by extracting the values referenced by the void
pointer, and will do so whenever the task in the thread pool's task list is assigned to a worker.

there will be one task that is an updater task. This task will always be present at position 0 in
the task list. when calculating the index of which task to assign to a worker thread, the following
equation will be used: A*B+(1-A)*C, where A is a flag that is either 0 or 1. This flag represents
whether or not the threadpool updater is currently running. B is set to the index of the next task
in the thread pool task list, while C is the index of the updater thread. When a thread requests a
new task, it will be assigned either the updater task, or the next task in the list. When the
update task completes, it will always set it's flag value (A) to 0, to represent the fact that it
has finished. The updater task will handle all i/o to the threadpool, and handle any other related
administration that needs to be performed.

the inputs to the threadpool will be in a bytecode style. The updater thread will run a simple VM
that deconstructs the json requests (stored in a mailbox that belongs to each of the running
worker threads) and stores the values from json in the threadpool task list. These requests will
not be able to do arbitrary code execution - they are stored specifically as bytecode values, which
correspond to functions that are stored in the implementation of the threadpool's "config" file.
The threadpool is designed as a library, and the config file is implementation specific. This file
will be imported by the threadpool, and the threadpool will be compiled for each project.

This design allows seamless integration between various languages, as the bytecode is stored as
json (something LLMs are naturally designed to output) and the output from each threadpool function
can be returned to the calling process as primitive datatype values.

A threadpool function does not need to return any output, it could simply modify the threadpool's
memory, which is accessed by referring to a location in shared memory. This location is referenced
in the json bytecode input with a text label. The updater thread deconstructs the json in each of
the worker thread's mailboxes (once per update) and removes one json request in a FIFO manner,
placing it in the next available slot of the threadpool task list. When the task list is full, it
loops back around to the beginning in a "ring buffer" style setup. If the slot where a task is to
be inserted is already taken (as determined by checking a flag A in this equation: A*B+(1-A)*C
where A is the flag (this slot is taken if 1, free if 0), B is a function pointer to check the next
slot (recursive style), and C is a function pointer to insert the task at that slot in the thread
pool task list) the update thread will check the next slot. This will continue until the updater
thread finds an open slot to insert the task into.

If a thread completes it's task, requests a new task, and is not assigned one, it will pause it's
execution until it is awoken by the updater thread. It will do this by setting a flag in it's
mailbox to 0, which is picked up by the updater thread every time it scans through the mailboxes.
When any task is inserted into the threadpool task list, the updater thread will set one single
worker thread's "is_active" flag to 1, or true. Whenever a worker thread completes it's active task
it will check to see if it has another task waiting in it's inbox (A*B+(1-A)*C, where A is the flag
that marks the inbox as containing a value, B is the function pointer which executes the next task
in the task list, and C is the function which puts the worker thread to sleep (by setting it's flag
and setting it in a dormant state.)

To execute a task, a worker thread will first check the threadpool tasklist by using the worker
thread's internal tasklist iterator value. This value is an index into the tasklist. It will then
attempt to assign that task to itself. It does this by first setting an "assigned_to" value (stored
with the task) to it's thread_id. Then, it copies the task values to it's internal memory. Then, it
checks to see if the assigned_to value is the same as it's thread_id value. If so, then that means
it was not double-assigned. If the assigned_to value is not zero when the worker thread attempts to
assign that task to itself, it will increment the tasklist iterator and check the next task, as the
previous task has been assigned in a non-atomic way, and therefore should be checked twice - once
before preparation, and once before execution. If either of these checks return a non-zero value
(the second check should subtract the thread_id) then the task has been double-assigned, and the
preparation should be scrapped and the next task should be attempted.


