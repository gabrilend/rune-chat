# Makefile for chat client C library
# Uses cJSON from libs/cJSON/

CC = gcc
CFLAGS = -Wall -Wextra -O2 -pthread -I../../libs/cJSON
LDFLAGS = -pthread

# cJSON source
CJSON_SRC = ../../libs/cJSON/cJSON.c
CJSON_OBJ = cJSON.o

# Chat client source
CHAT_SRC = chat_client.c
CHAT_OBJ = chat_client.o

# Library output
LIB = libchat.a

# Default target
all: $(LIB)

# Build static library
$(LIB): $(CHAT_OBJ) $(CJSON_OBJ)
	ar rcs $@ $^

# Compile chat client
$(CHAT_OBJ): $(CHAT_SRC) chat_client.h
	$(CC) $(CFLAGS) -c $< -o $@

# Compile cJSON
$(CJSON_OBJ): $(CJSON_SRC)
	$(CC) $(CFLAGS) -c $< -o $@

# Example program
example: example.c $(LIB)
	$(CC) $(CFLAGS) $< -L. -lchat $(LDFLAGS) -o $@

# Clean build artifacts
clean:
	rm -f $(CHAT_OBJ) $(CJSON_OBJ) $(LIB) example

# Install (optional)
PREFIX ?= /usr/local
install: $(LIB) chat_client.h
	install -d $(PREFIX)/lib $(PREFIX)/include
	install -m 644 $(LIB) $(PREFIX)/lib/
	install -m 644 chat_client.h $(PREFIX)/include/

.PHONY: all clean install
