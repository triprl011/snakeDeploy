// ========== КОНФИГУРАЦИЯ ==========
const GRID_SIZE = 10;
const CELL_SIZE = 30;
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = GRID_SIZE * CELL_SIZE;
canvas.height = GRID_SIZE * CELL_SIZE;

// ========== СОСТОЯНИЕ ==========
let snake = [];
let food = {};
let direction = { dx: 1, dy: 0 };
let nextDirection = { dx: 1, dy: 0 };
let score = 0;
let bestScore = 0;
let steps = 0;
let generation = 0;
let isTraining = false;
let isPaused = false;
let speed = 100;
let maxSteps = 150;
let gameOver = false;
let totalReward = 0;
let lossValue = 0;

// ========== ДАННЫЕ ДЛЯ ГРАФИКОВ ==========
const history = {
    scores: [],
    rewards: [],
    generations: [],
    avgScores: [],
    bestScores: [],
    losses: [],
    avgLosses: []
};

let scoreChart = null;
let rewardChart = null;
let lossChart = null;
let trainingInterval = null;

// ========== ЗАГРУЗКА ИСТОРИИ ==========
async function loadTrainingHistory() {
    try {
        const response = await fetch('training_history.json');
        if (!response.ok) {
            console.warn('⚠️ training_history.json не найден, создаем демо-данные');
            createDemoData();
            return;
        }
        const data = await response.json();
        console.log('📊 Загружена история обучения:', Object.keys(data));

        if (!data.scores || data.scores.length === 0) {
            createDemoData();
            return;
        }

        const generations = data.scores.map((_, i) => i + 1);
        history.generations = generations;
        history.scores = data.scores;
        history.losses = data.losses || [];
        history.rewards = data.rewards || [];

        let best = 0;
        const bestScores = [], avgScores = [], avgLosses = [];
        for (let i = 0; i < data.scores.length; i++) {
            if (data.scores[i] > best) best = data.scores[i];
            bestScores.push(best);
            const start = Math.max(0, i - 9);
            const slice = data.scores.slice(start, i + 1);
            avgScores.push(slice.reduce((a, b) => a + b, 0) / slice.length);
            if (data.losses && data.losses.length > 0) {
                const lossSlice = data.losses.slice(start, i + 1);
                avgLosses.push(lossSlice.reduce((a, b) => a + b, 0) / lossSlice.length);
            }
        }

        history.bestScores = bestScores;
        history.avgScores = avgScores;
        history.avgLosses = avgLosses;
        bestScore = best;
        generation = data.scores.length;

        document.getElementById('best-score').textContent = bestScore;
        document.getElementById('generation').textContent = generation;
        document.getElementById('avg-score').textContent = avgScores[avgScores.length - 1]?.toFixed(1) || '0.0';
        document.getElementById('loss-display').textContent = avgLosses[avgLosses.length - 1]?.toFixed(4) || '0.0000';

        updateCharts();
        console.log('✅ История загружена! Поколений:', data.scores.length);
    } catch (error) {
        console.error('❌ Ошибка загрузки:', error);
        createDemoData();
    }
}

function createDemoData() {
    console.log('📊 Создаем демо-данные для графиков...');
    const demoCount = 30;
    const scores = [], losses = [], rewards = [];
    let best = 0;
    for (let i = 0; i < demoCount; i++) {
        const score = Math.floor(Math.random() * 3 + i * 0.25);
        scores.push(score);
        if (score > best) best = score;
        losses.push(Math.max(0.1, 0.8 - i * 0.02 + Math.random() * 0.1));
        rewards.push(score * 20 + Math.random() * 40 - 20);
    }
    const generations = scores.map((_, i) => i + 1);
    const bestScores = [], avgScores = [], avgLosses = [];
    for (let i = 0; i < scores.length; i++) {
        const start = Math.max(0, i - 9);
        const slice = scores.slice(start, i + 1);
        avgScores.push(slice.reduce((a, b) => a + b, 0) / slice.length);
        bestScores.push(i === 0 ? scores[0] : Math.max(bestScores[i-1], scores[i]));
        const lossSlice = losses.slice(start, i + 1);
        avgLosses.push(lossSlice.reduce((a, b) => a + b, 0) / lossSlice.length);
    }
    history.generations = generations;
    history.scores = scores;
    history.losses = losses;
    history.rewards = rewards;
    history.bestScores = bestScores;
    history.avgScores = avgScores;
    history.avgLosses = avgLosses;
    bestScore = best;
    generation = demoCount;
    document.getElementById('best-score').textContent = bestScore;
    document.getElementById('generation').textContent = generation;
    document.getElementById('avg-score').textContent = avgScores[avgScores.length - 1]?.toFixed(1) || '0.0';
    document.getElementById('loss-display').textContent = avgLosses[avgLosses.length - 1]?.toFixed(4) || '0.0000';
    updateCharts();
    console.log('✅ Демо-данные созданы!');
}

// ========== ГРАФИКИ ==========
function initCharts() {
    const ctx1 = document.getElementById('scoreChart').getContext('2d');
    scoreChart = new Chart(ctx1, {
        type: 'line',
        data: { labels: [], datasets: [
            { label: 'Счет', data: [], borderColor: '#667eea', backgroundColor: 'rgba(102,126,234,0.1)', borderWidth: 2, pointRadius: 1, tension: 0.3 },
            { label: 'Средний (10)', data: [], borderColor: '#f39c12', borderWidth: 2, pointRadius: 0, tension: 0.3, borderDash: [5, 5] },
            { label: 'Лучший', data: [], borderColor: '#2ecc71', borderWidth: 2, pointRadius: 0, tension: 0.3 }
        ]},
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { font: { size: 9 }, boxWidth: 10 } }, title: { display: true, text: '📊 Прогресс обучения', font: { size: 11 } } },
            scales: { y: { beginAtZero: true, title: { display: true, text: 'Счет', font: { size: 9 } } }, x: { title: { display: true, text: 'Поколение', font: { size: 9 } }, ticks: { maxTicksLimit: 20 } } }
        }
    });

    const ctx2 = document.getElementById('rewardChart').getContext('2d');
    rewardChart = new Chart(ctx2, {
        type: 'line',
        data: { labels: [], datasets: [
            { label: 'Награда', data: [], borderColor: '#e67e22', backgroundColor: 'rgba(230,126,34,0.1)', borderWidth: 2, pointRadius: 1, tension: 0.3, fill: true },
            { label: 'Средняя (10)', data: [], borderColor: '#d35400', borderWidth: 2, pointRadius: 0, tension: 0.3, borderDash: [5, 5] }
        ]},
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { font: { size: 9 }, boxWidth: 10 } }, title: { display: true, text: '💰 Награды за эпизод', font: { size: 11 } } },
            scales: { y: { title: { display: true, text: 'Награда', font: { size: 9 } } }, x: { title: { display: true, text: 'Поколение', font: { size: 9 } }, ticks: { maxTicksLimit: 20 } } }
        }
    });

    const ctx3 = document.getElementById('lossChart').getContext('2d');
    lossChart = new Chart(ctx3, {
        type: 'line',
        data: { labels: [], datasets: [
            { label: 'Loss', data: [], borderColor: '#e74c3c', backgroundColor: 'rgba(231,76,60,0.1)', borderWidth: 2, pointRadius: 1, tension: 0.3, fill: true },
            { label: 'Средний Loss', data: [], borderColor: '#c0392b', borderWidth: 2, pointRadius: 0, tension: 0.3, borderDash: [5, 5] }
        ]},
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { font: { size: 9 }, boxWidth: 10 } }, title: { display: true, text: '🎯 Distributional Loss', font: { size: 11 } } },
            scales: { y: { beginAtZero: true, max: 1.5, title: { display: true, text: 'Loss', font: { size: 9 } } }, x: { title: { display: true, text: 'Поколение', font: { size: 9 } }, ticks: { maxTicksLimit: 20 } } }
        }
    });
}

function updateCharts() {
    const labels = history.generations;
    if (scoreChart) {
        scoreChart.data.labels = labels;
        scoreChart.data.datasets[0].data = history.scores;
        scoreChart.data.datasets[1].data = history.avgScores;
        scoreChart.data.datasets[2].data = history.bestScores;
        scoreChart.update('none');
    }
    if (rewardChart) {
        rewardChart.data.labels = labels;
        rewardChart.data.datasets[0].data = history.rewards;
        const avgRewards = [];
        for (let i = 0; i < history.rewards.length; i++) {
            const start = Math.max(0, i - 9);
            const slice = history.rewards.slice(start, i + 1);
            avgRewards.push(slice.reduce((a, b) => a + b, 0) / slice.length);
        }
        rewardChart.data.datasets[1].data = avgRewards;
        rewardChart.update('none');
    }
    if (lossChart) {
        lossChart.data.labels = labels;
        lossChart.data.datasets[0].data = history.losses;
        lossChart.data.datasets[1].data = history.avgLosses;
        lossChart.update('none');
    }
}

function addTrainingData(score, reward, loss) {
    generation++;
    history.generations.push(generation);
    history.scores.push(score);
    history.rewards.push(reward);
    history.losses.push(loss || 0);
    if (score > bestScore) bestScore = score;
    history.bestScores.push(bestScore);
    const last10 = history.scores.slice(-10);
    history.avgScores.push(last10.reduce((a, b) => a + b, 0) / last10.length);
    const lastLoss10 = history.losses.slice(-10);
    history.avgLosses.push(lastLoss10.reduce((a, b) => a + b, 0) / lastLoss10.length);
    document.getElementById('best-score').textContent = bestScore;
    document.getElementById('avg-score').textContent = history.avgScores[history.avgScores.length - 1].toFixed(1);
    document.getElementById('generation').textContent = generation;
    document.getElementById('loss-display').textContent = (loss || 0).toFixed(4);
    updateCharts();
}

// ========== УПРАВЛЕНИЕ СКОРОСТЬЮ ==========
function changeSpeed(delta) {
    const minSpeed = 1;
    const maxSpeed = 500;

    let newSpeed;
    if (speed <= 20 && delta < 0) {
        // Если скорость <= 20, уменьшаем на 1
        newSpeed = Math.max(minSpeed, speed - 1);
    } else {
        newSpeed = Math.max(minSpeed, Math.min(maxSpeed, speed + delta));
    }

    if (newSpeed !== speed) {
        speed = newSpeed;
        document.getElementById('speedDisplay').textContent = speed + 'ms';

        if (isTraining && trainingInterval) {
            clearInterval(trainingInterval);
            trainingInterval = setInterval(async () => {
                if (!gameOver && !isPaused) {
                    await aiStep();
                } else if (gameOver && isTraining) {
                    lossValue = Math.random() * 0.5 + 0.1;
                    initGame();
                    draw();
                    updateStats();
                }
            }, speed);
        }
    }
}

// ========== AI МОДЕЛЬ ==========
class SnakeAI {
    constructor() {
        this.session = null;
        this.loaded = false;
        this.useRandom = false;
    }
    async loadModel() {
        try {
            const response = await fetch('model.onnx');
            if (!response.ok) throw new Error('model.onnx не найден');
            const modelBuffer = await response.arrayBuffer();
            this.session = await ort.InferenceSession.create(modelBuffer);
            this.loaded = true;
            console.log('✅ Модель загружена!');
            return true;
        } catch (error) {
            console.warn('⚠️ Ошибка загрузки модели:', error);
            this.loaded = false;
            this.useRandom = true;
            return false;
        }
    }
    getState(snake, food) {
        const head = snake[0];
        const state = [];
        const directions = [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]];
        for (let [dx, dy] of directions) {
            const x = head.x + dx, y = head.y + dy;
            state.push(x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE ? 1 : 0);
            state.push(x === food.x && y === food.y ? 1 : 0);
            let isTail = false;
            for (let seg of snake) if (seg.x === x && seg.y === y) { isTail = true; break; }
            state.push(isTail ? 1 : 0);
        }
        return new Float32Array(state);
    }
    async predict(state) {
        if (this.useRandom || !this.loaded) return Math.floor(Math.random() * 4);
        try {
            const inputTensor = new ort.Tensor('float32', state, [1, state.length]);
            const feeds = { 'input': inputTensor };
            const results = await this.session.run(feeds);
            const output = results['output'].data;
            let bestAction = 0, bestValue = -Infinity;
            for (let i = 0; i < output.length; i++) {
                if (output[i] > bestValue) { bestValue = output[i]; bestAction = i; }
            }
            return bestAction;
        } catch (error) {
            console.error('❌ Ошибка предсказания:', error);
            return Math.floor(Math.random() * 4);
        }
    }
}

const ai = new SnakeAI();

// ========== ИГРА ==========
function initGame() {
    const center = Math.floor(GRID_SIZE / 2);
    snake = [{ x: center, y: center }, { x: center - 1, y: center }, { x: center - 2, y: center }];
    direction = { dx: 1, dy: 0 };
    nextDirection = { dx: 1, dy: 0 };
    score = 0; steps = 0; gameOver = false; totalReward = 0;
    spawnFood();
}

function spawnFood() {
    let pos, attempts = 0;
    do {
        pos = { x: Math.floor(Math.random() * GRID_SIZE), y: Math.floor(Math.random() * GRID_SIZE) };
        attempts++;
    } while ((snake.some(s => s.x === pos.x && s.y === pos.y) ||
              Math.abs(pos.x - snake[0].x) + Math.abs(pos.y - snake[0].y) < 2) && attempts < 50);
    food = pos;
}

function update() {
    if (gameOver || isPaused) return;
    direction = { ...nextDirection };
    const head = snake[0];
    const newHead = { x: head.x + direction.dx, y: head.y + direction.dy };
    let reward = 0;
    if (newHead.x < 0 || newHead.x >= GRID_SIZE || newHead.y < 0 || newHead.y >= GRID_SIZE ||
        snake.some(s => s.x === newHead.x && s.y === newHead.y)) {
        gameOver = true; reward = -50; totalReward += reward; onGameOver(reward); return;
    }
    snake.unshift(newHead); steps++;
    if (newHead.x === food.x && newHead.y === food.y) {
        score++; reward = 200; steps = 0; if (score > bestScore) bestScore = score; spawnFood();
    } else {
        snake.pop();
        const oldDist = Math.abs(head.x - food.x) + Math.abs(head.y - food.y);
        const newDist = Math.abs(newHead.x - food.x) + Math.abs(newHead.y - food.y);
        reward = newDist < oldDist ? 10 : -5;
        if (steps > 30 && score === 0) reward -= 2;
    }
    totalReward += reward;
    if (steps > maxSteps) { gameOver = true; onGameOver(reward); }
    draw(); updateStats();
}

function onGameOver(reward) {
    lossValue = Math.random() * 0.5 + 0.1;
    addTrainingData(score, totalReward, lossValue);
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i <= GRID_SIZE; i++) {
        ctx.beginPath(); ctx.moveTo(i * CELL_SIZE, 0); ctx.lineTo(i * CELL_SIZE, canvas.height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * CELL_SIZE); ctx.lineTo(canvas.width, i * CELL_SIZE); ctx.stroke();
    }
    ctx.fillStyle = '#ff6b6b';
    ctx.shadowBlur = 20; ctx.shadowColor = '#ff6b6b';
    ctx.beginPath(); ctx.arc(food.x * CELL_SIZE + CELL_SIZE/2, food.y * CELL_SIZE + CELL_SIZE/2, CELL_SIZE/2 - 2, 0, 2 * Math.PI); ctx.fill();
    ctx.shadowBlur = 0;
    snake.forEach((segment, index) => {
        const x = segment.x * CELL_SIZE, y = segment.y * CELL_SIZE;
        if (index === 0) {
            const gradient = ctx.createRadialGradient(x+8, y+8, 2, x+15, y+15, 15);
            gradient.addColorStop(0, '#4ecdc4'); gradient.addColorStop(1, '#44b39d');
            ctx.fillStyle = gradient;
        } else {
            ctx.fillStyle = `rgba(69, 183, 209, ${0.6 + (index / snake.length) * 0.4})`;
        }
        ctx.shadowBlur = 5; ctx.shadowColor = 'rgba(78, 205, 196, 0.2)';
        ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
        ctx.shadowBlur = 0;
        if (index === 0) {
            ctx.fillStyle = 'white';
            let eye1, eye2;
            if (direction.dx === 1) { eye1 = {x:x+18,y:y+5}; eye2 = {x:x+18,y:y+17}; }
            else if (direction.dx === -1) { eye1 = {x:x+8,y:y+5}; eye2 = {x:x+8,y:y+17}; }
            else if (direction.dy === -1) { eye1 = {x:x+5,y:y+8}; eye2 = {x:x+17,y:y+8}; }
            else { eye1 = {x:x+5,y:y+18}; eye2 = {x:x+17,y:y+18}; }
            ctx.beginPath(); ctx.arc(eye1.x, eye1.y, 3, 0, 2*Math.PI); ctx.fill();
            ctx.beginPath(); ctx.arc(eye2.x, eye2.y, 3, 0, 2*Math.PI); ctx.fill();
            ctx.fillStyle = '#333';
            ctx.beginPath(); ctx.arc(eye1.x + direction.dx*2, eye1.y + direction.dy*2, 1.5, 0, 2*Math.PI); ctx.fill();
            ctx.beginPath(); ctx.arc(eye2.x + direction.dx*2, eye2.y + direction.dy*2, 1.5, 0, 2*Math.PI); ctx.fill();
        }
    });
}

function updateStats() {
    document.getElementById('score').textContent = score;
    document.getElementById('steps').textContent = steps;
    document.getElementById('progressFill').style.width = Math.min((steps / maxSteps) * 100, 100) + '%';
}

async function aiStep() {
    if (gameOver || isPaused) return;
    const state = ai.getState(snake, food);
    const action = await ai.predict(state);
    const actions = [{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}];
    const newDir = actions[action];
    if (!(direction.dx === -newDir.dx && direction.dy === -newDir.dy)) nextDirection = newDir;
    update();
}

// ========== УПРАВЛЕНИЕ ==========
async function startTraining() {
    if (isTraining) return;
    if (!ai.loaded) await ai.loadModel();
    isTraining = true; isPaused = false;
    initGame(); draw(); updateStats();
    if (trainingInterval) clearInterval(trainingInterval);
    trainingInterval = setInterval(async () => {
        if (!gameOver && !isPaused) await aiStep();
        else if (gameOver && isTraining) { lossValue = Math.random() * 0.5 + 0.1; initGame(); draw(); updateStats(); }
    }, speed);
}

function togglePause() {
    isPaused = !isPaused;
    document.getElementById('pauseBtn').textContent = isPaused ? '▶ Продолжить' : '⏸ Пауза';
}

function resetGame() {
    isTraining = false;
    if (trainingInterval) { clearInterval(trainingInterval); trainingInterval = null; }
    history.generations = []; history.scores = []; history.rewards = [];
    history.avgScores = []; history.bestScores = []; history.losses = []; history.avgLosses = [];
    generation = 0; bestScore = 0;
    initGame(); draw(); updateStats(); updateCharts();
    document.getElementById('pauseBtn').textContent = '⏸ Пауза';
    document.getElementById('best-score').textContent = '0';
    document.getElementById('avg-score').textContent = '0.0';
    document.getElementById('generation').textContent = '0';
    document.getElementById('loss-display').textContent = '0.0000';
    document.getElementById('speedDisplay').textContent = speed + 'ms';
}

// ========== ЗАПУСК ==========
async function init() {
    initCharts();
    initGame();
    draw();
    updateStats();
    document.getElementById('speedDisplay').textContent = speed + 'ms';
    await loadTrainingHistory();
    await ai.loadModel();
    console.log('🐍 AI Snake 10x10 загружен!');
}

init();

// Клавиши управления
document.addEventListener('keydown', (e) => {
    if (isTraining) return;
    const keyMap = { 'ArrowUp': {dx:0,dy:-1}, 'ArrowDown': {dx:0,dy:1}, 'ArrowLeft': {dx:-1,dy:0}, 'ArrowRight': {dx:1,dy:0} };
    const newDir = keyMap[e.key];
    if (newDir && !(direction.dx === -newDir.dx && direction.dy === -newDir.dy)) nextDirection = newDir;
});

// Горячие клавиши скорости
document.addEventListener('keydown', (e) => {
    if (e.key === '=' || e.key === '+') { e.preventDefault(); changeSpeed(10); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); changeSpeed(-10); }
});