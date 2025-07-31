const express = require('express');
const cors = require('cors');
const { nanoid } = require('nanoid');
const qrcode = require('qrcode');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const sessions = {};

// 기본 경로 접속 시 index.html을 제공
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 1. 질문 세션 생성 (UPDATED FOR MULTI-QUESTION GAMES)
app.post('/api/session/create', (req, res) => {
    const { title, voteDuration, questions } = req.body;
    
    console.log('--- New Game Session Creation ---');
    console.log('Request Body:', req.body);

    if (!title || !voteDuration || !questions || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ error: 'Title, voteDuration, and at least one question are required.' });
    }

    const sessionId = nanoid(6);

    sessions[sessionId] = {
        title,
        voteDuration, // in seconds
        questions: questions.map(q => ({ ...q, votes: {} })), // Each question has its own vote storage
        participants: {},
        currentQuestionIndex: -1, // -1: Waiting to start, 0..n-1: In progress
        gameState: 'waiting', // 'waiting', 'voting', 'result', 'finished'
        deadline: null, // Will be set when a question starts
        finalChoice: null // This might be used per question later
    };
    
    console.log(`New session created with ID: ${sessionId}`);
    console.log('--------------------------------');

    res.status(201).json({ sessionId });
});

// Endpoint to get remaining time
app.get('/api/session/:id/time', (req, res) => {
    const { id } = req.params;
    const session = sessions[id];

    if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
    }

    const now = new Date();
    // If deadline is not set (e.g., game not started), return 0
    const remainingTime = session.deadline ? Math.max(0, Math.ceil((session.deadline - now) / 1000)) : 0; 

    res.status(200).json({ remainingTime });
});

// QR 코드 생성 및 전송 엔드포인트
app.get('/api/session/:id/qr', (req, res) => {
    const { id } = req.params;
    const session = sessions[id];

    if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
    }

    const joinUrl = `${req.protocol}://${req.get('host')}/join.html?session=${id}`;
    qrcode.toDataURL(joinUrl, (err, url) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to generate QR code.' });
        }
        // Data URL에서 실제 이미지 데이터 부분만 추출하여 버퍼로 변환
        const base64Data = url.replace(/^data:image\/png;base64,/, "");
        const img = Buffer.from(base64Data, 'base64');

        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': img.length
        });
        res.end(img);
    });
});


// 2. 참가자 입장
app.post('/api/session/:id/join', (req, res) => {
    const { id } = req.params;
    const { nickname } = req.body;
    const session = sessions[id];

    if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
    }
    if (!nickname) {
        return res.status(400).json({ error: 'Nickname is required.' });
    }
    if (session.participants[nickname]) {
        return res.status(409).json({ error: 'Nickname is already taken.' });
    }

    session.participants[nickname] = {}; // No vote info needed at top level
    
    console.log(`[Session: ${id}] Participant '${nickname}' joined.`);

    res.status(200).json({ message: 'Joined successfully.' });
});

// NEW: 호스트가 게임을 시작하거나 다음 질문으로 진행
app.post('/api/session/:id/next', (req, res) => {
    const { id } = req.params;
    const session = sessions[id];

    if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
    }

    // Move to the next question
    session.currentQuestionIndex++;
    
    if (session.currentQuestionIndex >= session.questions.length) {
        session.gameState = 'finished';
        console.log(`[Session: ${id}] Game has finished.`);
        return res.status(200).json({ message: 'Game has finished.', gameState: 'finished' });
    }
    
    // Reset for the new question
    session.gameState = 'voting';
    session.deadline = new Date(Date.now() + session.voteDuration * 1000);

    // Reset participants' vote status for the new question
    const currentQuestion = session.questions[session.currentQuestionIndex];
    currentQuestion.votes = {};

    console.log(`[Session: ${id}] Starting question #${session.currentQuestionIndex + 1}. Deadline: ${session.deadline}`);

    res.status(200).json({ 
        message: `Question #${session.currentQuestionIndex + 1} started.`,
        gameState: session.gameState,
        currentQuestionIndex: session.currentQuestionIndex,
        deadline: session.deadline
    });
});


// 3. 참가자 투표 (UPDATED)
app.post('/api/session/:id/vote', (req, res) => {
    const { id } = req.params;
    const { nickname, vote } = req.body;
    const session = sessions[id];

    if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
    }
    if (session.gameState !== 'voting') {
        return res.status(403).json({ error: 'Not currently in a voting phase.' });
    }
    if (!nickname || !vote) {
        return res.status(400).json({ error: 'Nickname and vote are required.' });
    }
    if (!session.participants[nickname]) {
        return res.status(403).json({ error: 'Participant not found in this session.' });
    }
    if (new Date() > session.deadline) {
        return res.status(403).json({ error: 'The voting session has ended.' });
    }
    if (vote !== 'O' && vote !== 'X') {
        return res.status(400).json({ error: 'Invalid vote. Must be O or X.' });
    }
    
    const currentQuestion = session.questions[session.currentQuestionIndex];
    if (currentQuestion.votes[nickname]) {
        return res.status(409).json({ error: 'You have already voted for this question.' });
    }

    currentQuestion.votes[nickname] = vote; // Store vote in the current question

    console.log(`[Session: ${id}] Participant '${nickname}' voted for '${vote}' on question #${session.currentQuestionIndex + 1}.`);

    res.status(200).json({ message: 'Vote registered successfully.' });
});

// 5. NEW: 호스트가 최종 결과를 결정
app.post('/api/session/:id/finalize', (req, res) => {
    try {
        const { id } = req.params;
        const { choice } = req.body;
        const session = sessions[id];

        if (!session) {
            return res.status(404).json({ error: 'Session not found.' });
        }
        
        const currentQuestion = session.questions[session.currentQuestionIndex];
        if (!currentQuestion) {
            return res.status(404).json({ error: 'Current question not found.'});
        }
        
        if (new Date() < session.deadline) {
            return res.status(403).json({ error: 'Voting has not ended yet.' });
        }
        if (!choice || (choice !== 'O' && choice !== 'X')) {
            return res.status(400).json({ error: 'Invalid choice. Must be O or X.' });
        }

        currentQuestion.finalChoice = choice;
        session.gameState = 'result'; // Update game state
        
        // Calculate and store losers for this question
        const voters = currentQuestion.votes;
        const voterList = { O: [], X: [] };
        Object.entries(voters).forEach(([nickname, vote]) => {
            if (vote === 'O') voterList.O.push(nickname);
            else if (vote === 'X') voterList.X.push(nickname);
        });
        currentQuestion.losers = (choice === 'O') ? voterList.X : voterList.O;

        console.log(`[Session: ${id}] Host finalized result for Q#${session.currentQuestionIndex} to '${choice}'. Losers: ${currentQuestion.losers.join(', ')}`);
        res.status(200).json({ message: 'Session finalized successfully.' });

    } catch (error) {
        console.error(`[FINALIZE ERROR] Session ID: ${req.params.id}, Error:`, error);
        res.status(500).json({ error: 'An unexpected server error occurred during finalization.' });
    }
});

// NEW: 호스트가 투표를 조기 종료
app.post('/api/session/:id/end', (req, res) => {
    const { id } = req.params;
    const session = sessions[id];

    if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
    }

    session.deadline = new Date(); // Set deadline to now
    session.gameState = 'result'; // Explicitly set game state to result
    console.log(`[Session: ${id}] Host ended the session early.`);
    res.status(200).json({ message: 'Session ended successfully.' });
});

// 4. 결과 조회
app.get('/api/session/:id/result', (req, res) => {
    const { id } = req.params;
    const session = sessions[id];

    if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
    }

    // Automatically transition from voting to result when time is up
    if (session.gameState === 'voting' && session.deadline && new Date() >= session.deadline) {
        session.gameState = 'result';
        console.log(`[Session: ${id}] Voting time ended for Q#${session.currentQuestionIndex}. State is now 'result'.`);
    }

    const currentQuestion = session.questions[session.currentQuestionIndex];

    const isFinalized = !!(currentQuestion && currentQuestion.finalChoice);
    
    // This part needs significant changes for multi-question format.
    // For now, let's return the general session state.
    const voters = currentQuestion ? currentQuestion.votes : {};
    const voterList = { O: [], X: [] };
     Object.entries(voters).forEach(([nickname, vote]) => {
        if (vote === 'O') {
            voterList.O.push(nickname);
        } else if (vote === 'X') {
            voterList.X.push(nickname);
        }
    });


    res.status(200).json({
        // OLD fields for compatibility for now
        isFinished: session.deadline ? new Date() >= session.deadline : false,
        isFinalized: isFinalized,
        question: currentQuestion ? currentQuestion.question : "대기 중...",
        penalty: currentQuestion ? currentQuestion.penalty : "",
        voters: voterList,
        finalChoice: currentQuestion ? currentQuestion.finalChoice : null,
        losers: currentQuestion && currentQuestion.losers ? currentQuestion.losers : [],

        // NEW fields
        title: session.title,
        gameState: session.gameState,
        currentQuestionIndex: session.currentQuestionIndex,
        totalQuestions: session.questions.length,
        participants: Object.keys(session.participants)
    });
});

// NEW: Get final game summary
app.get('/api/session/:id/summary', (req, res) => {
    const { id } = req.params;
    const session = sessions[id];

    if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
    }

    const loserCounts = {};
    // Initialize all participants with 0 losses
    Object.keys(session.participants).forEach(p => loserCounts[p] = 0);

    session.questions.forEach(q => {
        if (q.losers && q.losers.length > 0) {
            q.losers.forEach(loser => {
                if (loserCounts[loser] !== undefined) {
                    loserCounts[loser]++;
                }
            });
        }
    });

    res.status(200).json({
        title: session.title,
        results: loserCounts
    });
});


app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on http://10.249.56.27:${port}`);
});

process.on('uncaughtException', (err) => {
    console.error('An uncaught error occurred:', err);
    process.exit(1); // exit the process after logging
});
