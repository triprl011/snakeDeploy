// ========== КОНФИГУРАЦИЯ ==========
const GRID_SIZE = 20;
const CELL_SIZE = 20;
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ========== СОСТОЯНИЕ ИГРЫ ==========
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
let maxSteps = 500;
let gameOver = false;
let totalReward = 0;
let epsilon = 1.0;

// ========== ДАННЫЕ ДЛЯ ГРАФИКОВ ==========
const history = {
    scores: [],
    rewards: [],
    generations: [],
    avgScores: [],
    bestScores: []
};

// ========== ИНИЦИАЛИЗАЦИЯ ГРАФИКОВ ==========
let scoreChart, rewardChart;

function initCharts() {
    // График счетов
    const ctx1 = document.getElementById('scoreChart').getContext('2d');
    scoreChart = new Chart(ctx1, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Счет за игру',
                    data: [],
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102, 126, 234, 0.1)',
                    borderWidth: 2,
                    pointRadius: 2,
                    tension: 0.3
                },
                {
                    label: 'Средний (10 игр)',
                    data: [],
                    borderColor: '#f39c12',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.3,
                    borderDash: [5, 5]
                },
                {
                    label: 'Лучший счет',
                    data: [],
                    borderColor: '#2ecc71',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        font: { size: 10 },
                        boxWidth: 12
                    }
                },
                title: {
                    display: true,
                    text: '📊 Прогресс обучения',
                    font: { size: 12 }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Счет'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Поколение'
                    },
                    ticks: {
                        maxTicksLimit: 50
                    }
                }
            }
        }
    });

    // График наград
    const ctx2 = document.getElementById('rewardChart').getContext('2d');
    rewardChart = new Chart(ctx2, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Общая награда',
                    data: [],
                    borderColor: '#e74c3c',
                    backgroundColor: 'rgba(231, 76, 60, 0.1)',
                    borderWidth: 2,
                    pointRadius: 1,
                    tension: 0.3,
                    fill: true
                },
                {
                    label: 'Epsilon (исследование)',
                    data: [],
                    borderColor: '#9b59b6',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.3,
                    borderDash: [5, 5],
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        font: { size: 10 },
                        boxWidth: 12
                    }
                },
                title: {
                    display: true,
                    text: '🎯 Награды и исследование',
                    font: { size: 12 }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Награда'
                    }
                },
                y1: {
                    beginAtZero: true,
                    position: 'right',
                    max: 1,
                    title: {
                        display: true,
                        text: 'Epsilon'
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Поколение'
                    },
                    ticks: {
                        maxTicksLimit: 50
                    }
                }
            }
        }
    });
}

// ========== ОБНОВЛЕНИЕ ГРАФИКОВ ==========
function updateCharts() {
    const labels = history.generations;

    // Обновляем график счетов
    scoreChart.data.labels = labels;
    scoreChart.data.datasets[0].data = history.scores;
    scoreChart.data.datasets[1].data = history.avgScores;
    scoreChart.data.datasets[2].data = history.bestScores;
    scoreChart.update('none');

    // Обновляем график наград
    rewardChart.data.labels = labels;
    rewardChart.data.datasets[0].data = history.rewards;
    rewardChart.data.datasets[1].data = history.epsilonHistory || [];
    rewardChart.update('none');
}

// ========== ДОБАВЛЕНИЕ ДАННЫХ ==========
function addTrainingData(score, reward, eps) {
    generation++;

    // Добавляем данные
    history.generations.push(generation);
    history.scores.push(score);
    history.rewards.push(reward);
    history.epsilonHistory = history.epsilonHistory || [];
    history.epsilonHistory.push(eps);

    // Обновляем лучший счет
    if (score > bestScore) {
        bestScore = score;
    }
    history.bestScores.push(bestScore);

    // Вычисляем средний за 10 игр
    const last10 = history.scores.slice(-10);
    const avg = last10.reduce((a, b) => a + b, 0) / last10.length;
    history.avgScores.push(avg);

    // Обновляем статистику
    document.getElementById('best-score').textContent = bestScore;
    document.getElementById('avg-score').textContent = avg.toFixed(1);
    document.getElementById('epsilon').textContent = eps.toFixed(3);
    document.getElementById('generation').textContent = generation;

    // Обновляем графики
    updateCharts();
}

// ========== МОДЕЛЬ AI ==========
class SnakeAI {
    constructor() {
        this.session = null;
        this.loaded = false;
        this.useRandom = false;
        this.epsilon = 1.0;
    }

    async loadModel() {
        try {
            console.log('🔄 Загрузка модели...');
            const response = await fetch('model.onnx');
            if (!response.ok) throw new Error('model.onnx не найден');

            const modelBuffer = await response.arrayBuffer();
            this.session = await ort.InferenceSession.create(modelBuffer);
            this.loaded = true;
            console.log('✅ Модель загружена!');

            const configResponse = await fetch('model_config.json');
            if (configResponse.ok) {
                this.config = await configResponse.json();
            }
            return true;
        } catch (error) {
            console.warn('⚠️ Ошибка:', error);
            this.loaded = false;
            this.useRandom = true;
            return false;
        }
    }

    getState(snake, food) {
        const head = snake[0];
        const state = [];
        const directions = [
            [0, -1], [0, 1], [-1, 0], [1, 0],
            [-1, -1], [1, -1], [-1, 1], [1, 1]
        ];

        for (let [dx, dy] of directions) {
            const x = head.x + dx;
            const y = head.y + dy;

            state.push(x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE ? 1 : 0);
            state.push(x === food.x && y === food.y ? 1 : 0);

            let isTail = false;
            for (let segment of snake) {
                if (segment.x === x && segment.y === y) {
                    isTail = true;
                    break;
                }
            }
            state.push(isTail ? 1 : 0);
        }
        return new Float32Array(state);
    }

    async predict(state) {
        if (this.useRandom || !this.loaded || Math.random() < this.epsilon) {
            return Math.floor(Math.random() * 4);
        }

        try {
            const inputTensor = new ort.Tensor('float32', state, [1, state.length]);
            const feeds = { 'input': inputTensor };
            const results = await this.session.run(feeds);
            const output = results['output'].data;

            let bestAction = 0;
            let bestValue = -Infinity;
            for (let i = 0; i < output.length; i++) {
                if (output[i] > bestValue) {
                    bestValue = output[i];
                    bestAction = i;
                }
            }
            return bestAction;
        } catch (error) {
            console.error('❌ Ошибка:', error);
            return Math.floor(Math.random() * 4);
        }
    }
}

const ai = new SnakeAI();

// ========== ИНИЦИАЛИЗАЦИЯ ==========
function initGame() {
    const center = Math.floor(GRID_SIZE / 2);
    snake = [
        { x: center, y: center },
        { x: center - 1, y: center },
        { x: center - 2, y: center }
    ];
    direction = { dx: 1, dy: 0 };
    nextDirection = { dx: 1, dy: 0 };
    score = 0;
    steps = 0;
    gameOver = false;
    totalReward = 0;
    spawnFood();
}

function spawnFood() {
    let pos;
    let attempts = 0;
    do {
        pos = {
            x: Math.floor(Math.random() * GRID_SIZE),
            y: Math.floor(Math.random() * GRID_SIZE)
        };
        attempts++;
    } while ((snake.some(s => s.x === pos.x && s.y === pos.y) ||
              Math.abs(pos.x - snake[0].x) + Math.abs(pos.y - snake[0].y) < 3) &&
              attempts < 100);
    food = pos;
}

// ========== ЛОГИКА ИГРЫ ==========
function update() {
    if (gameOver || isPaused) return;

    direction = { ...nextDirection };
    const head = snake[0];
    const newHead = {
        x: head.x + direction.dx,
        y: head.y + direction.dy
    };

    let reward = 0;

    // Проверка столкновений
    if (newHead.x < 0 || newHead.x >= GRID_SIZE ||
        newHead.y < 0 || newHead.y >= GRID_SIZE ||
        snake.some(s => s.x === newHead.x && s.y === newHead.y)) {
        gameOver = true;
        reward = -50;
        totalReward += reward;
        updateBestScore();
        onGameOver(reward);
        return;
    }

    snake.unshift(newHead);
    steps++;

    // Проверка еды
    if (newHead.x === food.x && newHead.y === food.y) {
        score++;
        reward = 100;
        steps = 0;
        if (score > bestScore) bestScore = score;
        spawnFood();
    } else {
        snake.pop();

        // Награда за приближение к еде
        const oldDist = Math.abs(head.x - food.x) + Math.abs(head.y - food.y);
        const newDist = Math.abs(newHead.x - food.x) + Math.abs(newHead.y - food.y);
        reward = newDist < oldDist ? 8 : -4;

        // Штраф за долгие блуждания
        if (steps > 100 && score === 0) reward -= 2;

        // Бонус за выживание
        if (steps > 0 && steps % 50 === 0) reward += 3;
    }

    totalReward += reward;

    if (steps > maxSteps) {
        gameOver = true;
        onGameOver(reward);
    }

    draw();
    updateStats();
}

function onGameOver(reward) {
    // Добавляем данные в графики
    addTrainingData(score, totalReward, ai.epsilon || 1.0);

    // Обновляем epsilon (уменьшаем со временем)
    if (ai.epsilon > 0.01) {
        ai.epsilon = Math.max(0.01, ai.epsilon * 0.997);
    }
}

function updateBestScore() {
    if (score > bestScore) {
        bestScore = score;
        document.getElementById('best-score').textContent = bestScore;
    }
}

// ========== ОТРИСОВКА ==========
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Сетка
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i <= GRID_SIZE; i++) {
        ctx.beginPath();
        ctx.moveTo(i * CELL_SIZE, 0);
        ctx.lineTo(i * CELL_SIZE, canvas.height);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * CELL_SIZE);
        ctx.lineTo(canvas.width, i * CELL_SIZE);
        ctx.stroke();
    }

    // Еда
    ctx.fillStyle = '#ff6b6b';
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#ff6b6b';
    ctx.beginPath();
    ctx.arc(food.x * CELL_SIZE + CELL_SIZE/2, food.y * CELL_SIZE + CELL_SIZE/2, CELL_SIZE/2 - 1, 0, 2 * Math.PI);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Змейка
    snake.forEach((segment, index) => {
        const gradient = ctx.createRadialGradient(
            segment.x * CELL_SIZE + 5, segment.y * CELL_SIZE + 5, 2,
            segment.x * CELL_SIZE + 10, segment.y * CELL_SIZE + 10, 10
        );
        if (index === 0) {
            gradient.addColorStop(0, '#4ecdc4');
            gradient.addColorStop(1, '#44b39d');
        } else {
            const intensity = 0.5 + (index / snake.length) * 0.5;
            gradient.addColorStop(0, `rgba(69, 183, 209, ${intensity})`);
            gradient.addColorStop(1, `rgba(52, 152, 219, ${intensity})`);
        }
        ctx.fillStyle = gradient;
        ctx.shadowBlur = 5;
        ctx.shadowColor = 'rgba(78, 205, 196, 0.3)';
        ctx.fillRect(segment.x * CELL_SIZE + 1, segment.y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
        ctx.shadowBlur = 0;
    });
}

function updateStats() {
    document.getElementById('score').textContent = score;
    document.getElementById('steps').textContent = steps;

    const progress = Math.min((steps / maxSteps) * 100, 100);
    document.getElementById('progressFill').style.width = progress + '%';
}

// ========== AI ЛОГИКА ==========
async function aiStep() {
    if (gameOver || isPaused) return;

    const state = ai.getState(snake, food);
    const action = await ai.predict(state);

    const actions = [
        { dx: 0, dy: -1 },
        { dx: 0, dy: 1 },
        { dx: -1, dy: 0 },
        { dx: 1, dy: 0 }
    ];

    const newDir = actions[action];
    if (!(direction.dx === -newDir.dx && direction.dy === -newDir.dy)) {
        nextDirection = newDir;
    }

    update();
}

// ========== УПРАВЛЕНИЕ ОБУЧЕНИЕМ ==========
let trainingInterval = null;

async function startTraining() {
    if (isTraining) return;

    if (!ai.loaded) {
        await ai.loadModel();
    }

    isTraining = true;
    isPaused = false;

    initGame();
    draw();
    updateStats();

    if (trainingInterval) clearInterval(trainingInterval);
    trainingInterval = setInterval(async () => {
        if (!gameOver && !isPaused) {
            await aiStep();
        } else if (gameOver && isTraining) {
            // Рестарт
            initGame();
            draw();
            updateStats();
        }
    }, speed);
}

function togglePause() {
    isPaused = !isPaused;
    document.getElementById('pauseBtn').textContent = isPaused ? '▶ Продолжить' : '⏸ Пауза';
}

function resetGame() {
    isTraining = false;
    if (trainingInterval) {
        clearInterval(trainingInterval);
        trainingInterval = null;
    }

    // Сбрасываем историю
    history.generations = [];
    history.scores = [];
    history.rewards = [];
    history.avgScores = [];
    history.bestScores = [];
    history.epsilonHistory = [];
    generation = 0;
    bestScore = 0;
    ai.epsilon = 1.0;

    initGame();
    draw();
    updateStats();
    updateCharts();

    document.getElementById('pauseBtn').textContent = '⏸ Пауза';
    document.getElementById('best-score').textContent = '0';
    document.getElementById('avg-score').textContent = '0.0';
    document.getElementById('epsilon').textContent = '1.000';
    document.getElementById('generation').textContent = '0';
}

function toggleSpeed() {
    const speeds = [100, 50, 25, 200];
    const labels = ['1x', '2x', '4x', '0.5x'];
    let currentIndex = speeds.indexOf(speed);
    currentIndex = (currentIndex + 1) % speeds.length;
    speed = speeds[currentIndex];
    document.getElementById('speedBtn').textContent = `⚡ ${labels[currentIndex]}`;

    if (isTraining) {
        clearInterval(trainingInterval);
        trainingInterval = setInterval(async () => {
            if (!gameOver && !isPaused) {
                await aiStep();
            } else if (gameOver && isTraining) {
                initGame();
                draw();
                updateStats();
            }
        }, speed);
    }
}

// ========== ЗАПУСК ==========
initCharts();
initGame();
draw();
updateStats();
ai.loadModel();

console.log('🐍 AI Snake с графиками загружен!');