# Users CRUD Implementation Plan

A minimal, dependency-free Node.js Users CRUD used to smoke-test the SDLC
orchestrator end-to-end. A `User` has `{ name, surname, age }`. Two tasks: an
in-memory store, then an HTTP API on top of it.

## Overview

Plain Node.js (no ContaAzul skill, no external services). Keep it small and
self-contained so a real generate-backend run is fast.

## Task: User store

An in-memory user store module exposing CRUD operations over `User` records.

### Details

- A `User` is `{ id, name, surname, age }`; `id` is assigned by the store.
- Operations: `create`, `get`, `list`, `update`, `delete`.
- Validation: `name` and `surname` must be non-empty strings; `age` must be a
  positive integer. Invalid input is rejected with an error.

### Acceptance Criteria

- [ ] `create` adds a user, assigns an `id`, and returns the stored record.
- [ ] `get(id)` returns the user or undefined; `list()` returns all users.
- [ ] `update(id, fields)` mutates an existing user; `delete(id)` removes it.
- [ ] Creating/updating with an empty `name`/`surname` or a non-positive /
      non-integer `age` throws a validation error.

## Task: HTTP CRUD API

An HTTP server exposing REST routes for users, backed by the User store.

### Details

- Express (or Node's built-in `http`) server with JSON request/response bodies.
- Routes: `POST /users`, `GET /users`, `GET /users/:id`, `PUT /users/:id`,
  `DELETE /users/:id`.
- Delegates persistence to the User store from the previous task.

### Acceptance Criteria

- [ ] `POST /users` creates a user and returns `201` with the created record;
      invalid input returns `400`.
- [ ] `GET /users` returns `200` with the list; `GET /users/:id` returns `200`
      with the user or `404` when missing.
- [ ] `PUT /users/:id` updates and returns `200` (or `404`); `DELETE /users/:id`
      returns `204` (or `404`).
- [ ] All request and response bodies are JSON.

## Task Graph

```yaml
tasks:
  - name: "User store"
    complexity: LOW
    tdd: true
    depends_on: []
    summary: "In-memory user store with create/get/list/update/delete and field validation."
    acceptance_criteria:
      - "create assigns an id and returns the stored user"
      - "get/list/update/delete behave correctly"
      - "validation rejects empty name/surname and non-positive/non-integer age"
  - name: "HTTP CRUD API"
    complexity: LOW
    tdd: true
    depends_on: ["User store"]
    summary: "HTTP REST API (POST/GET/GET:id/PUT/DELETE /users) over the user store, JSON in/out with correct status codes."
    acceptance_criteria:
      - "POST creates (201) and validates (400)"
      - "GET list (200) and GET by id (200/404)"
      - "PUT updates (200/404), DELETE removes (204/404)"
```
