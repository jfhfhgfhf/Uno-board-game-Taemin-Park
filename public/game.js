const socket = io();

// DOM 요소
const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const roomIdInput = document.getElementById('room-id');
const createRoomBtn = document.getElementById('create-room');
const joinRoomBtn = document.getElementById('join-room');
const currentCardDiv = document.getElementById('current-card');
const cardsDiv = document.getElementById('cards');
const drawCardBtn = document.getElementById('draw-card');
const colorPicker = document.getElementById('color-picker');
const turnInfo = document.getElementById('turn-info');
const otherPlayersDiv = document.getElementById('other-players');
const unoButton = document.getElementById('uno-button');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
const currentRoomCode = document.getElementById('current-room-code');

let currentRoom = null;
let myTurn = false;
let selectedCard = null;
let myCards = [];
let currentGameState = null;
let playerName = null;

// 채팅 메시지 전송
function sendChat() {
    const message = chatInput.value.trim();
    if (message && currentRoom) {
        socket.emit('chat', {
            roomId: currentRoom,
            message: message
        });
        chatInput.value = '';
    }
}

// 채팅 전송 버튼 클릭
chatSend.addEventListener('click', sendChat);

// 채팅 입력창 엔터키 처리
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendChat();
    }
});

// 채팅 메시지 수신
socket.on('chat', (message) => {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${message.sender === playerName ? 'my-message' : 'other-message'}`;
    
    const senderDiv = document.createElement('div');
    senderDiv.className = 'sender';
    senderDiv.textContent = message.sender;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'content';
    contentDiv.textContent = message.message;
    
    messageDiv.appendChild(senderDiv);
    messageDiv.appendChild(contentDiv);
    chatMessages.appendChild(messageDiv);
    
    // 스크롤을 최신 메시지로 이동
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

// 플레이어 이름 할당 수신
socket.on('nameAssigned', (name) => {
    playerName = name;
});

// 방 생성
createRoomBtn.addEventListener('click', () => {
    const roomId = roomIdInput.value.trim() || Math.random().toString(36).substring(2, 8);
    const name = prompt('사용할 닉네임을 입력하세요:');
    if (name) {
        playerName = name;
        socket.emit('createRoom', roomId);
    }
});

// 방 참가
joinRoomBtn.addEventListener('click', () => {
    const roomId = roomIdInput.value.trim();
    if (roomId) {
        const name = prompt('사용할 닉네임을 입력하세요:');
        if (name) {
            playerName = name;
            socket.emit('joinRoom', roomId);
            socket.emit('setName', { roomId, name });
        }
    } else {
        alert('방 코드를 입력하세요!');
    }
});

// 카드 뽑기
drawCardBtn.addEventListener('click', () => {
    if (myTurn && currentRoom) {
        socket.emit('drawCard', currentRoom);
    }
});

// 색상 선택 이벤트
document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        if (selectedCard) {
            socket.emit('playCard', {
                roomId: currentRoom,
                card: selectedCard,
                chosenColor: color
            });
            colorPicker.style.display = 'none';
            selectedCard = null;
        }
    });
});

// 우노 버튼 클릭
unoButton.addEventListener('click', () => {
    if (currentRoom) {
        socket.emit('callUno', currentRoom);
    }
});

// 방 생성 완료
socket.on('roomCreated', (roomId) => {
    currentRoom = roomId;
    currentRoomCode.textContent = roomId;
    loginScreen.style.display = 'none';
    gameScreen.style.display = 'block';
});

// 방 참가 완료
socket.on('joinedRoom', (roomId) => {
    currentRoom = roomId;
    currentRoomCode.textContent = roomId;
    loginScreen.style.display = 'none';
    gameScreen.style.display = 'block';
});

// 게임 상태 업데이트
socket.on('gameState', (state) => {
    updateGameState(state);
});

// 플레이어 수 업데이트
socket.on('playerCount', (count) => {
    console.log(`현재 ${count}명의 플레이어가 참가중입니다.`);
});

socket.on('joinError', (message) => {
    alert(message);
});

// 우노 콜 이벤트 수신
socket.on('unoCall', (data) => {
    if (data.type === 'called') {
        showMessage(`플레이어 ${data.playerIndex + 1}가 "UNO!" 를 외쳤습니다!`);
    } else if (data.type === 'caught') {
        showMessage(`플레이어 ${data.by + 1}가 플레이어 ${data.playerIndex + 1}의 UNO 미선언을 지적했습니다! (+2장)`);
    }
});

function updateGameState(state) {
    currentGameState = state;
    // 현재 카드 업데이트
    currentCardDiv.innerHTML = '';
    if (state.currentCard) {
        currentCardDiv.appendChild(createCardElement(state.currentCard));
    }

    // 내 카드 업데이트
    cardsDiv.innerHTML = '';
    myCards = state.myCards;
    state.myCards.forEach(card => {
        const cardElement = createCardElement(card);
        cardsDiv.appendChild(cardElement);
    });

    // 턴 정보 업데이트
    myTurn = state.currentPlayer === state.myIndex;
    turnInfo.textContent = myTurn ? '당신의 턴입니다!' : `플레이어 ${state.currentPlayer + 1}의 턴입니다.`;
    turnInfo.style.color = myTurn ? '#00aa00' : '#666666';
    drawCardBtn.disabled = !myTurn;

    // 우노 버튼 상태 업데이트
    if (state.unoState && state.unoState.playerWithTwoCards !== null) {
        unoButton.disabled = state.unoState.unoCalled;
    } else {
        unoButton.disabled = true;
    }

    // 다른 플레이어 정보 업데이트
    otherPlayersDiv.innerHTML = '';
    state.otherPlayers.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = `player ${player.isCurrentTurn ? 'current-turn' : ''}`;
        playerDiv.innerHTML = `
            <div>플레이어 ${player.index + 1}</div>
            <div class="card-count">카드 ${player.cardCount}장</div>
        `;
        otherPlayersDiv.appendChild(playerDiv);
    });

    // 채팅 메시지 업데이트
    if (state.messages) {
        chatMessages.innerHTML = '';
        state.messages.forEach(message => {
            const messageDiv = document.createElement('div');
            messageDiv.className = `chat-message ${message.sender === playerName ? 'my-message' : 'other-message'}`;
            
            const senderDiv = document.createElement('div');
            senderDiv.className = 'sender';
            senderDiv.textContent = message.sender;
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'content';
            contentDiv.textContent = message.message;
            
            messageDiv.appendChild(senderDiv);
            messageDiv.appendChild(contentDiv);
            chatMessages.appendChild(messageDiv);
        });
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

function createCardElement(card) {
    const div = document.createElement('div');
    div.className = `card ${card.type}`;
    
    // 와일드 카드의 선택된 색상 적용
    if (card.type === 'wild' && card.selectedColor) {
        div.classList.add(`selected-${card.selectedColor}`);
    }

    let content = '';
    if (card.type === 'number') {
        content = card.number;
        div.style.backgroundColor = card.color;
    } else if (card.type === 'action') {
        content = card.action;
        div.style.backgroundColor = card.color;
    } else if (card.type === 'wild') {
        content = card.action || 'wild';
    }
    
    div.setAttribute('data-content', content);
    return div;
}

// 카드 클릭 이벤트
cardsDiv.addEventListener('click', (e) => {
    if (!myTurn) return;
    
    const cardElement = e.target.closest('.card');
    if (!cardElement) return;
    
    const index = Array.from(cardsDiv.children).indexOf(cardElement);
    const card = myCards[index];
    
    if (isValidPlay(card, currentGameState.currentCard)) {
        // 모든 카드를 즉시 플레이
        socket.emit('playCard', {
            roomId: currentRoom,
            card: card,
            chosenColor: card.type === 'wild' ? 'red' : undefined // 와일드 카드의 경우 임시로 빨간색 설정
        });

        // 와일드 카드인 경우 색상 선택 버튼 표시
        if (card.type === 'wild') {
            showColorPicker(card);
        }
    }
});

// 색상 선택창 표시
function showColorPicker(card) {
    const colorPicker = document.getElementById('color-picker');
    colorPicker.style.display = 'block';
    
    const colorButtons = colorPicker.querySelectorAll('.color-btn');
    colorButtons.forEach(btn => {
        const color = btn.getAttribute('data-color');
        btn.onclick = () => {
            // 색상 변경만 서버에 전송
            socket.emit('changeWildColor', {
                roomId: currentRoom,
                color: color
            });
            colorPicker.style.display = 'none';
        };
    });
}

function isValidPlay(card, currentCard) {
    if (card.type === 'wild') return true;
    if (card.type === 'number') return card.color === currentCard.color || card.number === currentCard.number;
    if (card.type === 'action') return card.color === currentCard.color || card.action === currentCard.action;
    return false;
}

function showMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'game-message';
    messageDiv.textContent = message;
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        messageDiv.classList.add('show');
        setTimeout(() => {
            messageDiv.classList.remove('show');
            setTimeout(() => {
                messageDiv.remove();
            }, 300);
        }, 2000);
    }, 100);
}
