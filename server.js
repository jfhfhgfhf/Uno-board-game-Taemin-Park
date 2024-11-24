const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

const rooms = new Map();
const playerNames = new Map();
const colors = ['red', 'blue', 'green', 'yellow'];
const numbers = Array.from({length: 10}, (_, i) => i);
const actions = ['skip', 'reverse', 'draw2'];
const wilds = ['wild', 'wilddraw4'];

function createDeck() {
    let deck = [];
    // 일반 숫자 카드
    colors.forEach(color => {
        numbers.forEach(num => {
            deck.push({ color, number: num, type: 'number' });
            if (num !== 0) { // 0은 각 색상당 1장만
                deck.push({ color, number: num, type: 'number' });
            }
        });
        // 특수 카드
        actions.forEach(action => {
            deck.push({ color, action, type: 'action' });
            deck.push({ color, action, type: 'action' });
        });
    });
    // 와일드 카드
    wilds.forEach(wild => {
        for (let i = 0; i < 4; i++) {
            deck.push({ type: 'wild', action: wild });
        }
    });
    return shuffle(deck);
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function createRoom(roomId) {
    return {
        players: [],
        deck: createDeck(),
        currentCard: null,
        currentPlayer: 0,
        direction: 1,
        unoState: {
            playerWithTwoCards: null,
            unoCalled: false,
            unoCalledBy: null
        },
        messages: []  // 채팅 메시지 저장
    };
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('createRoom', (roomId) => {
        if (rooms.has(roomId)) {
            socket.emit('error', '이미 존재하는 방 코드입니다.');
            return;
        }

        const room = createRoom(roomId);
        room.players.push({
            id: socket.id,
            cards: [],
            name: playerNames.get(socket.id) || `플레이어 ${1}`
        });

        rooms.set(roomId, room);
        socket.join(roomId);
        socket.emit('roomCreated', roomId);
        
        // 방 생성자의 이름 설정
        socket.emit('nameAssigned', room.players[0].name);
    });

    socket.on('joinRoom', (roomId) => {
        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('joinError', '존재하지 않는 방 코드입니다!');
            return;
        }
        if (room.players.length >= 4) {
            socket.emit('joinError', '방이 가득 찼습니다!');
            return;
        }
        room.players.push({ id: socket.id, cards: [], name: playerNames.get(socket.id) || `플레이어 ${room.players.length + 1}` });
        socket.join(roomId);
        socket.emit('joinedRoom', roomId);

        // 2명 이상이면 게임 시작
        if (room.players.length >= 2) {
            startGame(roomId);
        }
        else {
            console.log('플레이어 들어오는 중......................');
        }

        // 모든 플레이어에게 현재 플레이어 수 알림
        io.to(roomId).emit('playerCount', room.players.length);
    });

    socket.on('playCard', ({ roomId, card, chosenColor }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== room.currentPlayer) return;

        const player = room.players[playerIndex];
        const currentCard = room.currentCard;

        if (isValidPlay(card, currentCard, chosenColor)) {
            const cardIndex = player.cards.findIndex(c => 
                c.type === card.type && 
                c.color === card.color && 
                (c.number === card.number || c.action === card.action)
            );

            if (cardIndex !== -1) {
                // 카드를 내기 전에 카드가 2장이었는지 확인
                const hadThreeCards = player.cards.length === 3;

                player.cards.splice(cardIndex, 1);
                
                // 와일드 카드인 경우 선택한 색상 적용
                if (card.type === 'wild' && chosenColor) {
                    card.selectedColor = chosenColor;
                }
                room.currentCard = card;
                
                // 특수 카드 효과 처리
                handleSpecialCard(room, card);

                // 카드를 낸 후 2장이 되었는지 확인
                if (hadThreeCards && player.cards.length === 2) {
                    room.unoState = {
                        playerWithTwoCards: playerIndex,
                        unoCalled: false,
                        unoCalledBy: null
                    };
                }

                // 다음 플레이어로 턴 넘기기
                room.currentPlayer = (room.currentPlayer + room.direction + room.players.length) % room.players.length;

                // 게임 상태 업데이트
                updateGameState(roomId);
            }
        }
    });

    socket.on('drawCard', (roomId) => {
        const room = rooms.get(roomId);
        if (!room) return;

        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== room.currentPlayer) return;

        const player = room.players[playerIndex];
        if (room.deck.length === 0) {
            room.deck = createDeck();
        }
        
        const card = room.deck.pop();
        player.cards.push(card);
        
        // 다음 플레이어로 턴 넘기기
        room.currentPlayer = (room.currentPlayer + room.direction + room.players.length) % room.players.length;
        
        // 게임 상태 업데이트
        updateGameState(roomId);
    });

    socket.on('callUno', (roomId) => {
        const room = rooms.get(roomId);
        if (!room || !room.unoState.playerWithTwoCards) return;

        const callingPlayerIndex = room.players.findIndex(p => p.id === socket.id);
        
        // 우노를 외치지 않은 플레이어가 2장 있을 때
        if (!room.unoState.unoCalled) {
            if (callingPlayerIndex === room.unoState.playerWithTwoCards) {
                // 자신이 우노를 외침
                room.unoState.unoCalled = true;
                room.unoState.unoCalledBy = callingPlayerIndex;
                io.to(roomId).emit('unoCall', {
                    playerIndex: callingPlayerIndex,
                    type: 'called'
                });
            } else {
                // 다른 플레이어가 우노 지적
                const playerWithTwoCards = room.players[room.unoState.playerWithTwoCards];
                // 카드 2장 추가
                for (let i = 0; i < 2; i++) {
                    if (room.deck.length === 0) room.deck = createDeck();
                    playerWithTwoCards.cards.push(room.deck.pop());
                }
                room.unoState = { playerWithTwoCards: null, unoCalled: false, unoCalledBy: null };
                io.to(roomId).emit('unoCall', {
                    playerIndex: room.unoState.playerWithTwoCards,
                    type: 'caught',
                    by: callingPlayerIndex
                });
                updateGameState(roomId);
            }
        }
    });

    socket.on('chat', ({ roomId, message }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        const chatMessage = {
            sender: player.name,
            message: message,
            timestamp: new Date().toISOString()
        };

        room.messages.push(chatMessage);
        io.to(roomId).emit('chat', chatMessage);
    });

    socket.on('setName', ({ roomId, name }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.name = name;
            playerNames.set(socket.id, name);
            io.to(roomId).emit('playerUpdate', room.players);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // 방에서 플레이어 제거
        rooms.forEach((room, roomId) => {
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                room.players.splice(playerIndex, 1);
                if (room.players.length === 0) {
                    rooms.delete(roomId);
                }
            }
        });
    });

    // 와일드 카드 색상 변경
    socket.on('changeWildColor', (data) => {
        const room = rooms.get(data.roomId);
        if (!room) return;

        // 현재 카드의 색상 변경
        if (room.currentCard && room.currentCard.type === 'wild') {
            room.currentCard.color = data.color;
            updateGameState(data.roomId);
        }
    });
});

function startGame(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;

    // 각 플레이어에게 7장의 카드 배분
    room.players.forEach(player => {
        player.cards = room.deck.splice(0, 7);
    });

    // 첫 카드 놓기 (와일드 카드가 아닌 카드가 나올 때까지)
    do {
        room.currentCard = room.deck.pop();
    } while (room.currentCard.type === 'wild');

    // 게임 상태 업데이트
    updateGameState(roomId);
}

function isValidPlay(card, currentCard, chosenColor) {
    if (card.type === 'wild') return true;
    if (currentCard.type === 'wild') return true;
    
    return card.color === currentCard.color || 
           (card.type === 'number' && currentCard.type === 'number' && card.number === currentCard.number) ||
           (card.type === 'action' && currentCard.type === 'action' && card.action === currentCard.action);
}

function handleSpecialCard(room, card) {
    if (card.type === 'action') {
        switch (card.action) {
            case 'reverse':
                room.direction *= -1;
                break;
            case 'skip':
                room.currentPlayer = (room.currentPlayer + room.direction + room.players.length) % room.players.length;
                break;
            case 'draw2':
                const nextPlayer = (room.currentPlayer + room.direction + room.players.length) % room.players.length;
                for (let i = 0; i < 2; i++) {
                    if (room.deck.length === 0) room.deck = createDeck();
                    room.players[nextPlayer].cards.push(room.deck.pop());
                }
                break;
        }
    } else if (card.type === 'wild' && card.action === 'wilddraw4') {
        const nextPlayer = (room.currentPlayer + room.direction + room.players.length) % room.players.length;
        for (let i = 0; i < 4; i++) {
            if (room.deck.length === 0) room.deck = createDeck();
            room.players[nextPlayer].cards.push(room.deck.pop());
        }
    }
}

function updateGameState(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;

    // 각 플레이어에게 게임 상태 전송
    room.players.forEach((player, index) => {
        const playerState = {
            currentCard: room.currentCard,
            currentPlayer: room.currentPlayer,
            myIndex: index,
            direction: room.direction,
            myCards: player.cards,
            otherPlayers: room.players.map((p, i) => ({
                id: p.id,
                cardCount: p.cards.length,
                index: i,
                isCurrentTurn: i === room.currentPlayer
            })).filter(p => p.id !== player.id),
            unoState: room.unoState,
            messages: room.messages
        };
        io.to(player.id).emit('gameState', playerState);
    });
}

const PORT = process.env.PORT || 3300;
http.listen(PORT, () => {
    console.log(`http://localhost:${PORT}`);
});
