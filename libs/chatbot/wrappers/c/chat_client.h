/*
 * chat_client.h - C wrapper for Ollama chat API
 *
 * Pure C implementation with pthreads for async operation.
 * Provides token streaming, conversation history, and multiple contexts.
 */

#ifndef CHAT_CLIENT_H
#define CHAT_CLIENT_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Opaque context handle */
typedef struct chat_context chat_context_t;

/* Token callback: called from worker thread as tokens arrive */
typedef void (*chat_token_callback_t)(const char* token, void* user_data);

/* Done callback: called when response is complete */
typedef void (*chat_done_callback_t)(const char* full_response, void* user_data);

/* Error callback: called on error */
typedef void (*chat_error_callback_t)(const char* error_message, void* user_data);

/*
 * Create a new chat context.
 *
 * Parameters:
 *   host  - Server hostname (e.g., "192.168.0.61")
 *   port  - Server port (e.g., 11434)
 *   model - Model name (e.g., "nemotron-3-nano")
 *
 * Returns: New context, or NULL on failure.
 * Caller must call chat_context_free() when done.
 */
chat_context_t* chat_context_new(const char* host, int port, const char* model);

/*
 * Free a chat context.
 * Stops any running request and frees all resources.
 */
void chat_context_free(chat_context_t* ctx);

/*
 * Send a message asynchronously.
 * Returns immediately; callbacks fire from worker thread.
 *
 * Parameters:
 *   ctx       - Chat context
 *   message   - User message to send
 *   on_token  - Called for each token (may be NULL)
 *   on_done   - Called when complete (may be NULL)
 *   on_error  - Called on error (may be NULL)
 *   user_data - Passed to callbacks
 *
 * Returns: 0 on success, -1 if request already in progress.
 */
int chat_send_async(chat_context_t* ctx,
                    const char* message,
                    chat_token_callback_t on_token,
                    chat_done_callback_t on_done,
                    chat_error_callback_t on_error,
                    void* user_data);

/*
 * Send a message and block until complete.
 *
 * Parameters:
 *   ctx      - Chat context
 *   message  - User message to send
 *   on_token - Called for each token (may be NULL for no streaming)
 *
 * Returns: Full response string (caller must free), or NULL on error.
 */
char* chat_send_blocking(chat_context_t* ctx,
                         const char* message,
                         chat_token_callback_t on_token);

/*
 * Poll for tokens from async request.
 * Thread-safe; returns tokens accumulated since last poll.
 *
 * Parameters:
 *   ctx   - Chat context
 *   count - Output: number of tokens returned
 *
 * Returns: NULL-terminated array of token strings.
 *          Caller must free array and each string.
 *          Returns NULL if no tokens available.
 */
char** chat_poll_tokens(chat_context_t* ctx, int* count);

/*
 * Check if async request is complete.
 *
 * Returns: 1 if complete (or no request), 0 if in progress.
 */
int chat_is_done(chat_context_t* ctx);

/*
 * Get full response after completion.
 *
 * Returns: Response string (owned by context, do not free).
 *          Returns NULL if no response available.
 */
const char* chat_get_response(chat_context_t* ctx);

/*
 * Get last error message.
 *
 * Returns: Error string (owned by context, do not free).
 *          Returns NULL if no error.
 */
const char* chat_get_error(chat_context_t* ctx);

/*
 * Clear conversation history.
 * Starts fresh conversation while keeping connection config.
 */
void chat_clear(chat_context_t* ctx);

/*
 * Get number of messages in history.
 */
int chat_get_message_count(chat_context_t* ctx);

/*
 * Get a message from history.
 *
 * Parameters:
 *   ctx     - Chat context
 *   index   - Message index (0 to count-1)
 *   role    - Output: message role (do not free)
 *   content - Output: message content (do not free)
 *
 * Returns: 0 on success, -1 if index out of range.
 */
int chat_get_message(chat_context_t* ctx, int index,
                     const char** role, const char** content);

/*
 * Add a message to history manually.
 * Useful for restoring conversation state.
 *
 * Parameters:
 *   ctx     - Chat context
 *   role    - Message role ("user", "assistant", "system")
 *   content - Message content
 *
 * Returns: 0 on success, -1 on failure.
 */
int chat_add_message(chat_context_t* ctx, const char* role, const char* content);

/*
 * Set timeout for requests.
 *
 * Parameters:
 *   ctx     - Chat context
 *   seconds - Timeout in seconds (default: 60)
 */
void chat_set_timeout(chat_context_t* ctx, int seconds);

#ifdef __cplusplus
}
#endif

#endif /* CHAT_CLIENT_H */
