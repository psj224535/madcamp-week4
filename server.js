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

// 1. 질문 세션 생성
app.post('/api/session/create', (req, res) => {
    const { question, penalty, deadline } = req.body;
    
    console.log('--- New Session Creation ---');
    console.log('Received deadline string from browser:', deadline);

    if (!question || !penalty || !deadline) {
        return res.status(400).json({ error: 'Question, penalty, and deadline are required.' });
    }

    const sessionId = nanoid(6);
    const deadlineDate = new Date(deadline);
    
    console.log('Parsed deadline as Date object:', deadlineDate);
    console.log('--------------------------');


    sessions[sessionId] = {
        question,
        penalty,
        deadline: deadlineDate,
        participants: {}, // Changed: Will store individual votes like { "nickname": { vote: "O" } }
        finalChoice: null // Will be 'O' or 'X'
    };

    res.status(201).json({ sessionId });
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

    session.participants[nickname] = { voted: false };
    
    console.log(`[Session: ${id}] Participant '${nickname}' joined.`);

    res.status(200).json({ message: 'Joined successfully.' });
});

// 3. 참가자 투표
app.post('/api/session/:id/vote', (req, res) => {
    const { id } = req.params;
    const { nickname, vote } = req.body;
    const session = sessions[id];

    if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
    }
    if (!nickname || !vote) {
        return res.status(400).json({ error: 'Nickname and vote are required.' });
    }
    if (!session.participants[nickname]) {
        return res.status(403).json({ error: 'Participant not found in this session.' });
    }
    if (session.participants[nickname].vote) { // Changed to check for existing vote
        return res.status(409).json({ error: 'You have already voted.' });
    }
    if (new Date() > session.deadline) {
        return res.status(403).json({ error: 'The voting session has ended.' });
    }
    if (vote !== 'O' && vote !== 'X') {
        return res.status(400).json({ error: 'Invalid vote. Must be O or X.' });
    }

    session.participants[nickname].vote = vote; // Store individual vote

    console.log(`[Session: ${id}] Participant '${nickname}' voted for '${vote}'.`);

    res.status(200).json({ message: 'Vote registered successfully.' });
});

// NEW: 호스트가 투표를 조기 종료
app.post('/api/session/:id/end', (req, res) => {
    const { id } = req.params;
    const session = sessions[id];

    if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
    }

    session.deadline = new Date(); // Set deadline to now
    console.log(`[Session: ${id}] Host ended the session early.`);
    res.status(200).json({ message: 'Session ended successfully.' });
});

// 5. NEW: 호스트가 최종 결과를 결정
app.post('/api/session/:id/finalize', (req, res) => {
    const { id } = req.params;
    const { choice } = req.body;
    const session = sessions[id];

    if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
    }
    if (new Date() < session.deadline) {
        return res.status(403).json({ error: 'Voting has not ended yet.' });
    }
     if (!choice || (choice !== 'O' && choice !== 'X')) {
        return res.status(400).json({ error: 'Invalid choice. Must be O or X.' });
    }

    session.finalChoice = choice;
    console.log(`[Session: ${id}] Host finalized the result to '${choice}'.`);
    res.status(200).json({ message: 'Session finalized successfully.' });
});


// 4. 결과 조회
app.get('/api/session/:id/result', (req, res) => {
    const { id } = req.params;
    const session = sessions[id];

    if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
    }

    const isFinished = new Date() >= session.deadline;
    const isFinalized = !!session.finalChoice;

    const voters = { O: [], X: [] };
    Object.entries(session.participants).forEach(([nickname, data]) => {
        if (data.vote === 'O') {
            voters.O.push(nickname);
        } else if (data.vote === 'X') {
            voters.X.push(nickname);
        }
    });

    if (!isFinished) {
        return res.status(200).json({
            isFinished: false,
            isFinalized: false,
            question: session.question,
            voters: voters,
            message: 'Voting is still in progress.'
        });
    }

    res.status(200).json({
        isFinished: true,
        isFinalized: isFinalized,
        question: session.question,
        penalty: session.penalty,
        voters: voters,
        finalChoice: session.finalChoice,
        losers: isFinalized ? (session.finalChoice === 'O' ? voters.X : voters.O) : []
    });
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

process.on('uncaughtException', (err) => {
    console.error('An uncaught error occurred:', err);
    process.exit(1); // exit the process after logging
});
