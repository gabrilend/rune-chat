/*
 * example.c - Example usage of chat_client library
 */

#include "chat_client.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* Token callback - print tokens as they arrive */
void on_token(const char* token, void* user_data) {
    (void)user_data;
    printf("%s", token);
    fflush(stdout);
}

/* Done callback */
void on_done(const char* full_response, void* user_data) {
    (void)user_data;
    (void)full_response;
    printf("\n[Done]\n");
}

/* Error callback */
void on_error(const char* error, void* user_data) {
    (void)user_data;
    fprintf(stderr, "\n[Error: %s]\n", error);
}

int main(int argc, char** argv) {
    const char* host = "192.168.0.61";
    int port = 11434;
    const char* model = "nemotron-3-nano";

    /* Parse optional arguments */
    if (argc > 1) host = argv[1];
    if (argc > 2) port = atoi(argv[2]);
    if (argc > 3) model = argv[3];

    printf("Connecting to %s:%d using model %s\n\n", host, port, model);

    /* Create context */
    chat_context_t* ctx = chat_context_new(host, port, model);
    if (!ctx) {
        fprintf(stderr, "Failed to create chat context\n");
        return 1;
    }

    /* --- Blocking mode demo --- */
    printf("=== Blocking Mode ===\n");
    printf("User: Hello, what is your name?\n");
    printf("Assistant: ");

    char* response = chat_send_blocking(ctx, "Hello, what is your name? Answer briefly.", on_token);
    if (!response) {
        fprintf(stderr, "Error: %s\n", chat_get_error(ctx) ?: "Unknown error");
    } else {
        free(response);
    }
    printf("\n");

    /* --- Async mode demo --- */
    printf("=== Async Mode ===\n");
    printf("User: What is 2 + 2?\n");
    printf("Assistant: ");

    if (chat_send_async(ctx, "What is 2 + 2? Answer briefly.",
                        on_token, on_done, on_error, NULL) < 0) {
        fprintf(stderr, "Failed to send async request\n");
    } else {
        /* Wait for completion */
        while (!chat_is_done(ctx)) {
            usleep(10000);  /* 10ms */
        }
    }
    printf("\n");

    /* --- Show conversation history --- */
    printf("=== Conversation History ===\n");
    int count = chat_get_message_count(ctx);
    for (int i = 0; i < count; i++) {
        const char* role;
        const char* content;
        if (chat_get_message(ctx, i, &role, &content) == 0) {
            printf("%d. [%s]: %.50s%s\n", i + 1, role, content,
                   strlen(content) > 50 ? "..." : "");
        }
    }

    /* --- Clear and new conversation --- */
    printf("\n=== New Conversation (after clear) ===\n");
    chat_clear(ctx);

    printf("User: Tell me a joke.\n");
    printf("Assistant: ");

    response = chat_send_blocking(ctx, "Tell me a very short joke.", on_token);
    if (response) {
        free(response);
    }
    printf("\n");

    /* Cleanup */
    chat_context_free(ctx);

    printf("\n=== Demo Complete ===\n");
    return 0;
}
