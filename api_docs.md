# 슈뢰딩거 게임 API 명세서

## 1. 질문 세션 생성

- **Method:** `POST`
- **URL:** `/api/session/create`
- **Description:** 새로운 질문 세션을 생성하고 고유한 세션 ID를 발급합니다.
- **Request Body:**
  ```json
  {
    "question": "string",
    "penalty": "string",
    "deadline": "ISO 8601 aaaa-mm-ddThh:mm:ss"
  }
  ```
- **Success Response (201 Created):**
  ```json
  {
    "sessionId": "string"
  }
  ```
- **Error Response (400 Bad Request):**
  ```json
  {
    "error": "Question, penalty, and deadline are required."
  }
  ```

---

## 2. 참가자 입장

- **Method:** `POST`
- **URL:** `/api/session/:id/join`
- **Description:** QR 코드를 통해 접속한 참가자가 닉네임을 등록하고 세션에 참여합니다.
- **Request Body:**
  ```json
  {
    "nickname": "string"
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "message": "Joined successfully."
  }
  ```
- **Error Responses:**
  - **404 Not Found:**
    ```json
    {
      "error": "Session not found."
    }
    ```
  - **400 Bad Request:**
    ```json
    {
      "error": "Nickname is required."
    }
    ```
  - **409 Conflict:**
    ```json
    {
      "error": "Nickname is already taken."
    }
    ```

---

## 3. 참가자 투표

- **Method:** `POST`
- **URL:** `/api/session/:id/vote`
- **Description:** 참가자가 O 또는 X로 투표합니다.
- **Request Body:**
  ```json
  {
    "nickname": "string",
    "vote": "O | X"
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "message": "Vote registered successfully."
  }
  ```
- **Error Responses:**
  - **404 Not Found:** `{"error": "Session not found."}`
  - **400 Bad Request:** `{"error": "Nickname and vote are required."}` or `{"error": "Invalid vote. Must be O or X."}`
  - **403 Forbidden:** `{"error": "Participant not found in this session."}` or `{"error": "The voting session has ended."}`
  - **409 Conflict:** `{"error": "You have already voted."}`

---

## 4. 결과 조회

- **Method:** `GET`
- **URL:** `/api/session/:id/result`
- **Description:** 세션의 마감 여부를 확인하고, 마감되었을 경우 집계 결과를 반환합니다.
- **Success Response (200 OK):**
  - **투표 진행 중:**
    ```json
    {
      "isFinished": false,
      "message": "Voting is still in progress."
    }
    ```
  - **투표 마감:**
    ```json
    {
      "isFinished": true,
      "question": "string",
      "penalty": "string",
      "votes": {
        "O": "number",
        "X": "number"
      }
    }
    ```
- **Error Response (404 Not Found):**
  ```json
  {
    "error": "Session not found."
  }
  ``` 