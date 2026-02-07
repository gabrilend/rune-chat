/*
 * chat_client.c - Pure C implementation of Ollama chat client
 * Uses cJSON library from libs/cJSON/
 */

#include "chat_client.h"
#include "../../libs/cJSON/cJSON.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <pthread.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <errno.h>

/* Message in conversation history */
typedef struct {
    char* role;
    char* content;
} chat_message_t;

/* Token buffer entry */
typedef struct token_node {
    char* token;
    struct token_node* next;
} token_node_t;

/* Chat context structure */
struct chat_context {
    /* Connection config */
    char* host;
    int port;
    char* model;
    int timeout;

    /* Conversation history */
    chat_message_t* messages;
    int message_count;
    int message_capacity;

    /* Worker thread */
    pthread_t worker_thread;
    pthread_mutex_t mutex;
    pthread_cond_t cond;
    int thread_started;

    /* Request state */
    char* pending_message;
    chat_token_callback_t on_token;
    chat_done_callback_t on_done;
    chat_error_callback_t on_error;
    void* user_data;

    /* Response state */
    token_node_t* token_head;
    token_node_t* token_tail;
    int token_count;
    char* full_response;
    size_t response_len;
    size_t response_capacity;
    char* error_message;
    int is_done;
    int shutdown;
};

/* Internal: add message to history */
static int add_message(chat_context_t* ctx, const char* role, const char* content) {
    pthread_mutex_lock(&ctx->mutex);

    if (ctx->message_count >= ctx->message_capacity) {
        int new_cap = ctx->message_capacity * 2;
        if (new_cap == 0) new_cap = 16;
        chat_message_t* new_msgs = realloc(ctx->messages, new_cap * sizeof(chat_message_t));
        if (!new_msgs) {
            pthread_mutex_unlock(&ctx->mutex);
            return -1;
        }
        ctx->messages = new_msgs;
        ctx->message_capacity = new_cap;
    }

    ctx->messages[ctx->message_count].role = strdup(role);
    ctx->messages[ctx->message_count].content = strdup(content);
    ctx->message_count++;

    pthread_mutex_unlock(&ctx->mutex);
    return 0;
}

/* Internal: append to response buffer */
static void append_to_response(chat_context_t* ctx, const char* text) {
    size_t len = strlen(text);

    pthread_mutex_lock(&ctx->mutex);

    if (ctx->response_len + len + 1 > ctx->response_capacity) {
        size_t new_cap = ctx->response_capacity * 2;
        if (new_cap < ctx->response_len + len + 1) {
            new_cap = ctx->response_len + len + 1024;
        }
        char* new_buf = realloc(ctx->full_response, new_cap);
        if (!new_buf) {
            pthread_mutex_unlock(&ctx->mutex);
            return;
        }
        ctx->full_response = new_buf;
        ctx->response_capacity = new_cap;
    }

    memcpy(ctx->full_response + ctx->response_len, text, len);
    ctx->response_len += len;
    ctx->full_response[ctx->response_len] = '\0';

    pthread_mutex_unlock(&ctx->mutex);
}

/* Internal: buffer token for polling */
static void buffer_token(chat_context_t* ctx, const char* token) {
    token_node_t* node = malloc(sizeof(token_node_t));
    if (!node) return;

    node->token = strdup(token);
    node->next = NULL;

    pthread_mutex_lock(&ctx->mutex);

    if (ctx->token_tail) {
        ctx->token_tail->next = node;
    } else {
        ctx->token_head = node;
    }
    ctx->token_tail = node;
    ctx->token_count++;

    pthread_mutex_unlock(&ctx->mutex);
}

/* Internal: TCP connect */
static int tcp_connect(const char* host, int port) {
    struct addrinfo hints, *result, *rp;
    int sock = -1;
    char port_str[16];

    memset(&hints, 0, sizeof(hints));
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;

    snprintf(port_str, sizeof(port_str), "%d", port);

    if (getaddrinfo(host, port_str, &hints, &result) != 0) {
        return -1;
    }

    for (rp = result; rp != NULL; rp = rp->ai_next) {
        sock = socket(rp->ai_family, rp->ai_socktype, rp->ai_protocol);
        if (sock == -1) continue;

        if (connect(sock, rp->ai_addr, rp->ai_addrlen) == 0) {
            break;
        }

        close(sock);
        sock = -1;
    }

    freeaddrinfo(result);
    return sock;
}

/* Internal: send HTTP request */
static int send_http_request(int sock, const char* host, int port, const char* body) {
    char header[512];
    int header_len = snprintf(header, sizeof(header),
        "POST /api/chat HTTP/1.1\r\n"
        "Host: %s:%d\r\n"
        "Content-Type: application/json\r\n"
        "Content-Length: %zu\r\n"
        "Connection: close\r\n"
        "\r\n",
        host, port, strlen(body));

    if (send(sock, header, header_len, 0) != header_len) return -1;
    if (send(sock, body, strlen(body), 0) != (ssize_t)strlen(body)) return -1;

    return 0;
}

/* Internal: read line from socket */
static int read_line(int sock, char* buffer, int max_len) {
    int pos = 0;
    char c;

    while (pos < max_len - 1) {
        int n = recv(sock, &c, 1, 0);
        if (n <= 0) {
            if (pos > 0) break;
            return -1;
        }
        if (c == '\n') break;
        if (c != '\r') {
            buffer[pos++] = c;
        }
    }

    buffer[pos] = '\0';
    return pos;
}

/* Internal: create chat request JSON using cJSON */
static char* create_chat_request(chat_context_t* ctx) {
    cJSON* root = cJSON_CreateObject();
    if (!root) return NULL;

    cJSON_AddStringToObject(root, "model", ctx->model);
    cJSON_AddBoolToObject(root, "stream", 1);
    cJSON_AddBoolToObject(root, "think", 1);

    cJSON* messages = cJSON_CreateArray();
    if (!messages) {
        cJSON_Delete(root);
        return NULL;
    }

    pthread_mutex_lock(&ctx->mutex);
    for (int i = 0; i < ctx->message_count; i++) {
        cJSON* msg = cJSON_CreateObject();
        cJSON_AddStringToObject(msg, "role", ctx->messages[i].role);
        cJSON_AddStringToObject(msg, "content", ctx->messages[i].content);
        cJSON_AddItemToArray(messages, msg);
    }
    pthread_mutex_unlock(&ctx->mutex);

    cJSON_AddItemToObject(root, "messages", messages);

    char* json_str = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);

    return json_str;
}

/* Internal: parse token from JSON response line */
static char* parse_token_from_json(const char* line, int* done) {
    *done = 0;

    cJSON* root = cJSON_Parse(line);
    if (!root) return NULL;

    /* Check done flag */
    cJSON* done_field = cJSON_GetObjectItemCaseSensitive(root, "done");
    if (cJSON_IsTrue(done_field)) {
        *done = 1;
    }

    /* Get message.content */
    cJSON* message = cJSON_GetObjectItemCaseSensitive(root, "message");
    if (!message) {
        cJSON_Delete(root);
        return NULL;
    }

    cJSON* content = cJSON_GetObjectItemCaseSensitive(message, "content");
    char* result = NULL;

    if (cJSON_IsString(content) && content->valuestring && strlen(content->valuestring) > 0) {
        result = strdup(content->valuestring);
    }

    cJSON_Delete(root);
    return result;
}

/* Internal: stream response */
static void stream_response(int sock, chat_context_t* ctx) {
    char line_buffer[8192];

    /* Skip HTTP headers */
    while (read_line(sock, line_buffer, sizeof(line_buffer)) > 0) {
        if (strlen(line_buffer) == 0) break;
    }

    /* Read JSON lines */
    while (read_line(sock, line_buffer, sizeof(line_buffer)) >= 0) {
        /* Skip empty lines and chunk size indicators */
        if (strlen(line_buffer) == 0) continue;

        /* Check if it's a hex chunk size (chunked encoding) */
        int is_hex = 1;
        for (char* p = line_buffer; *p && is_hex; p++) {
            if (!(*p >= '0' && *p <= '9') &&
                !(*p >= 'a' && *p <= 'f') &&
                !(*p >= 'A' && *p <= 'F')) {
                is_hex = 0;
            }
        }
        if (is_hex && strlen(line_buffer) < 8) continue;

        /* Parse JSON */
        if (line_buffer[0] == '{') {
            int done = 0;
            char* token = parse_token_from_json(line_buffer, &done);

            if (token) {
                /* Append to full response */
                append_to_response(ctx, token);

                /* Buffer for polling */
                buffer_token(ctx, token);

                /* Invoke callback */
                if (ctx->on_token) {
                    ctx->on_token(token, ctx->user_data);
                }

                free(token);
            }

            if (done) break;
        }
    }
}

/* Worker thread function */
static void* worker_loop(void* arg) {
    chat_context_t* ctx = (chat_context_t*)arg;

    while (1) {
        pthread_mutex_lock(&ctx->mutex);

        /* Wait for request or shutdown */
        while (!ctx->pending_message && !ctx->shutdown) {
            pthread_cond_wait(&ctx->cond, &ctx->mutex);
        }

        if (ctx->shutdown) {
            pthread_mutex_unlock(&ctx->mutex);
            break;
        }

        /* Get pending message */
        char* msg = ctx->pending_message;
        ctx->pending_message = NULL;
        pthread_mutex_unlock(&ctx->mutex);

        /* Add user message to history */
        add_message(ctx, "user", msg);

        /* Build request JSON */
        char* request_body = create_chat_request(ctx);

        if (!request_body) {
            pthread_mutex_lock(&ctx->mutex);
            ctx->error_message = strdup("Failed to create request");
            ctx->is_done = 1;
            pthread_mutex_unlock(&ctx->mutex);

            if (ctx->on_error) {
                ctx->on_error(ctx->error_message, ctx->user_data);
            }
            free(msg);
            continue;
        }

        /* Connect */
        int sock = tcp_connect(ctx->host, ctx->port);
        if (sock < 0) {
            pthread_mutex_lock(&ctx->mutex);
            ctx->error_message = strdup("Connection failed");
            ctx->is_done = 1;
            pthread_mutex_unlock(&ctx->mutex);

            if (ctx->on_error) {
                ctx->on_error(ctx->error_message, ctx->user_data);
            }
            free(request_body);
            free(msg);
            continue;
        }

        /* Set socket timeout */
        struct timeval tv;
        tv.tv_sec = ctx->timeout;
        tv.tv_usec = 0;
        setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

        /* Send request */
        if (send_http_request(sock, ctx->host, ctx->port, request_body) < 0) {
            pthread_mutex_lock(&ctx->mutex);
            ctx->error_message = strdup("Send failed");
            ctx->is_done = 1;
            pthread_mutex_unlock(&ctx->mutex);

            if (ctx->on_error) {
                ctx->on_error(ctx->error_message, ctx->user_data);
            }
            close(sock);
            free(request_body);
            free(msg);
            continue;
        }

        free(request_body);

        /* Stream response */
        stream_response(sock, ctx);

        close(sock);

        /* Add assistant response to history */
        pthread_mutex_lock(&ctx->mutex);
        if (ctx->full_response && ctx->response_len > 0) {
            pthread_mutex_unlock(&ctx->mutex);
            add_message(ctx, "assistant", ctx->full_response);
            pthread_mutex_lock(&ctx->mutex);
        }
        ctx->is_done = 1;
        pthread_mutex_unlock(&ctx->mutex);

        /* Invoke done callback */
        if (ctx->on_done) {
            ctx->on_done(ctx->full_response, ctx->user_data);
        }

        free(msg);
    }

    return NULL;
}

/* Public API implementation */

chat_context_t* chat_context_new(const char* host, int port, const char* model) {
    chat_context_t* ctx = calloc(1, sizeof(chat_context_t));
    if (!ctx) return NULL;

    ctx->host = strdup(host ? host : "192.168.0.61");
    ctx->port = port > 0 ? port : 11434;
    ctx->model = strdup(model ? model : "nemotron-3-nano");
    ctx->timeout = 60;
    ctx->is_done = 1;

    pthread_mutex_init(&ctx->mutex, NULL);
    pthread_cond_init(&ctx->cond, NULL);

    /* Start worker thread */
    if (pthread_create(&ctx->worker_thread, NULL, worker_loop, ctx) == 0) {
        ctx->thread_started = 1;
    }

    return ctx;
}

void chat_context_free(chat_context_t* ctx) {
    if (!ctx) return;

    /* Signal shutdown */
    pthread_mutex_lock(&ctx->mutex);
    ctx->shutdown = 1;
    pthread_cond_signal(&ctx->cond);
    pthread_mutex_unlock(&ctx->mutex);

    /* Wait for thread */
    if (ctx->thread_started) {
        pthread_join(ctx->worker_thread, NULL);
    }

    /* Free messages */
    for (int i = 0; i < ctx->message_count; i++) {
        free(ctx->messages[i].role);
        free(ctx->messages[i].content);
    }
    free(ctx->messages);

    /* Free token buffer */
    token_node_t* node = ctx->token_head;
    while (node) {
        token_node_t* next = node->next;
        free(node->token);
        free(node);
        node = next;
    }

    free(ctx->host);
    free(ctx->model);
    free(ctx->full_response);
    free(ctx->error_message);
    free(ctx->pending_message);

    pthread_mutex_destroy(&ctx->mutex);
    pthread_cond_destroy(&ctx->cond);

    free(ctx);
}

int chat_send_async(chat_context_t* ctx,
                    const char* message,
                    chat_token_callback_t on_token,
                    chat_done_callback_t on_done,
                    chat_error_callback_t on_error,
                    void* user_data) {
    if (!ctx || !message) return -1;

    pthread_mutex_lock(&ctx->mutex);

    if (!ctx->is_done) {
        pthread_mutex_unlock(&ctx->mutex);
        return -1;  /* Request already in progress */
    }

    /* Reset state */
    ctx->is_done = 0;
    free(ctx->full_response);
    ctx->full_response = NULL;
    ctx->response_len = 0;
    ctx->response_capacity = 0;
    free(ctx->error_message);
    ctx->error_message = NULL;

    /* Clear token buffer */
    token_node_t* node = ctx->token_head;
    while (node) {
        token_node_t* next = node->next;
        free(node->token);
        free(node);
        node = next;
    }
    ctx->token_head = NULL;
    ctx->token_tail = NULL;
    ctx->token_count = 0;

    /* Set callbacks */
    ctx->on_token = on_token;
    ctx->on_done = on_done;
    ctx->on_error = on_error;
    ctx->user_data = user_data;

    /* Set pending message */
    ctx->pending_message = strdup(message);

    /* Signal worker */
    pthread_cond_signal(&ctx->cond);
    pthread_mutex_unlock(&ctx->mutex);

    return 0;
}

char* chat_send_blocking(chat_context_t* ctx,
                         const char* message,
                         chat_token_callback_t on_token) {
    if (!ctx || !message) return NULL;

    /* Use async with synchronous wait */
    if (chat_send_async(ctx, message, on_token, NULL, NULL, NULL) < 0) {
        return NULL;
    }

    /* Wait for completion */
    while (!chat_is_done(ctx)) {
        usleep(10000);  /* 10ms */
    }

    /* Return copy of response */
    pthread_mutex_lock(&ctx->mutex);
    char* result = ctx->full_response ? strdup(ctx->full_response) : NULL;
    pthread_mutex_unlock(&ctx->mutex);

    return result;
}

char** chat_poll_tokens(chat_context_t* ctx, int* count) {
    if (!ctx || !count) return NULL;

    pthread_mutex_lock(&ctx->mutex);

    if (ctx->token_count == 0) {
        *count = 0;
        pthread_mutex_unlock(&ctx->mutex);
        return NULL;
    }

    /* Allocate array */
    char** tokens = malloc((ctx->token_count + 1) * sizeof(char*));
    if (!tokens) {
        *count = 0;
        pthread_mutex_unlock(&ctx->mutex);
        return NULL;
    }

    /* Copy tokens */
    int i = 0;
    token_node_t* node = ctx->token_head;
    while (node) {
        tokens[i++] = node->token;
        node->token = NULL;  /* Transfer ownership */
        node = node->next;
    }
    tokens[i] = NULL;
    *count = ctx->token_count;

    /* Free nodes */
    node = ctx->token_head;
    while (node) {
        token_node_t* next = node->next;
        free(node);
        node = next;
    }
    ctx->token_head = NULL;
    ctx->token_tail = NULL;
    ctx->token_count = 0;

    pthread_mutex_unlock(&ctx->mutex);
    return tokens;
}

int chat_is_done(chat_context_t* ctx) {
    if (!ctx) return 1;

    pthread_mutex_lock(&ctx->mutex);
    int done = ctx->is_done;
    pthread_mutex_unlock(&ctx->mutex);

    return done;
}

const char* chat_get_response(chat_context_t* ctx) {
    if (!ctx) return NULL;

    pthread_mutex_lock(&ctx->mutex);
    const char* response = ctx->full_response;
    pthread_mutex_unlock(&ctx->mutex);

    return response;
}

const char* chat_get_error(chat_context_t* ctx) {
    if (!ctx) return NULL;

    pthread_mutex_lock(&ctx->mutex);
    const char* error = ctx->error_message;
    pthread_mutex_unlock(&ctx->mutex);

    return error;
}

void chat_clear(chat_context_t* ctx) {
    if (!ctx) return;

    pthread_mutex_lock(&ctx->mutex);

    for (int i = 0; i < ctx->message_count; i++) {
        free(ctx->messages[i].role);
        free(ctx->messages[i].content);
    }
    ctx->message_count = 0;

    pthread_mutex_unlock(&ctx->mutex);
}

int chat_get_message_count(chat_context_t* ctx) {
    if (!ctx) return 0;

    pthread_mutex_lock(&ctx->mutex);
    int count = ctx->message_count;
    pthread_mutex_unlock(&ctx->mutex);

    return count;
}

int chat_get_message(chat_context_t* ctx, int index,
                     const char** role, const char** content) {
    if (!ctx || !role || !content) return -1;

    pthread_mutex_lock(&ctx->mutex);

    if (index < 0 || index >= ctx->message_count) {
        pthread_mutex_unlock(&ctx->mutex);
        return -1;
    }

    *role = ctx->messages[index].role;
    *content = ctx->messages[index].content;

    pthread_mutex_unlock(&ctx->mutex);
    return 0;
}

int chat_add_message(chat_context_t* ctx, const char* role, const char* content) {
    if (!ctx || !role || !content) return -1;
    return add_message(ctx, role, content);
}

void chat_set_timeout(chat_context_t* ctx, int seconds) {
    if (!ctx) return;

    pthread_mutex_lock(&ctx->mutex);
    ctx->timeout = seconds > 0 ? seconds : 60;
    pthread_mutex_unlock(&ctx->mutex);
}
