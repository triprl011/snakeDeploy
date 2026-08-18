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
let maxSteps = 1000;
let gameOver = false;

// ========== МОДЕЛЬ AI ==========
class SnakeAI {
    constructor() {
        this.model = null;
        this.config = null;
        this.loaded = false;
    }

    async loadModel() {
        try {
            // Загружаем конфиг
            const configResponse = await fetch('model_config.json');
            this.config = await configResponse.json();

            // Загружаем модель ONNX
            const modelResponse = await fetch('model.onnx');
            const modelBuffer = await modelResponse.arrayBuffer();

            // Создаем сессию ONNX Runtime
            this.session = await ort.InferenceSession.create(modelBuffer);
            this.loaded = true;
            console.log('✅ Модель загружена!');
            return true;
        } catch (error) {
            console.error('❌ Ошибка загрузки модели:', error);
            // Используем случайную политику как fallback
            return false;
        }
    }

    getState(snake, food) {
        const head = snake[0];
        const state = [];

        // 8 направлений: вверх, вниз, влево, вправо, и диагонали
        const directions = [
            [0, -1], [0, 1], [-1, 0], [1, 0],
            [-1, -1], [1, -1], [-1, 1], [1, 1]
        ];

        for (let [dx, dy] of directions) {
            const x = head.x + dx;
            const y = head.y + dy;

            // Стена
            state.push(x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE ? 1 : 0);

            // Еда
            state.push(x === food.x && y === food.y ? 1 : 0);

            // Хвост (свое тело)
            let isTail = false;
            for (let segment of snake) {
                if (segment.x === x && segment.y === y) {
                    isTail = true;
                    break;
                }
            }
            state.push(isTail ? 1 : 0);
        }

        return state;
    }

    async predict(state) {
        if (!this.loaded) {
            // Случайное действие как fallback
            return Math.floor(Math.random() * 4);
        }

        try {
            const input = new Float32Array(state);
            const tensor = new ort.Tensor('float32', input, [1, state.length]);

            const feeds = { 'input': tensor };
            const results = await this.session.run(feeds);

            const output = results['output'].data;
            return output.indexOf(Math.max(...output));
        } catch (error) {
            console.error('Ошибка предсказания:', error);
            return Math.floor(Math.random() * 4);
        }
    }
}

const ai = new SnakeAI();

// ========== ИНИЦИАЛИЗАЦИЯ ==========
function initGame() {
    snake = [
        { x: 10, y: 10 },
        { x: 9, y: 10 },
        { x: 8, y: 10 }
    ];
    direction = { dx: 1, dy: 0 };
    nextDirection = { dx: 1, dy: 0 };
    score = 0;
    steps = 0;
    gameOver = false;
    spawnFood();
}

function spawnFood() {
    let pos;
    do {
        pos = {
            x: Math.floor(Math.random() * GRID_SIZE),
            y: Math.floor(Math.random() * GRID_SIZE)
        };
    } while (snake.some(s => s.x === pos.x && s.y === pos.y));
    food = pos;
}

// ========== ЛОГИКА ИГРЫ ==========
function update() {
    if (gameOver || isPaused) return;

    // Обновляем направление
    direction = { ...nextDirection };

    // Вычисляем новую голову
    const head = snake[0];
    const newHead = {
        x: head.x + direction.dx,
        y: head.y + direction.dy
    };

    // Проверка столкновения со стеной
    if (newHead.x < 0 || newHead.x >= GRID_SIZE ||
        newHead.y < 0 || newHead.y >= GRID_SIZE) {
        gameOver = true;
        updateBestScore();
        return;
    }

    // Проверка столкновения с собой
    if (snake.some(s => s.x === newHead.x && s.y === newHead.y)) {
        gameOver = true;
        updateBestScore();
        return;
    }

    // Добавляем новую голову
    snake.unshift(newHead);

    // Проверка еды
    if (newHead.x === food.x && newHead.y === food.y) {
        score++;
        steps = 0;
        if (score > bestScore) bestScore = score;
        spawnFood();
    } else {
        snake.pop();
        steps++;
    }

    // Проверка на слишком долгую игру
    if (steps > maxSteps) {
        gameOver = true;
    }

    draw();
    updateStats();
}

// ========== ОТРИСОВКА ==========
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Сетка (полупрозрачная)
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
            gradient.addColorStop(0, '#45b7d1');
            gradient.addColorStop(1, '#3498db');
        }
        ctx.fillStyle = gradient;
        ctx.shadowBlur = 5;
        ctx.shadowColor = 'rgba(78, 205, 196, 0.3)';
        ctx.fillRect(segment.x * CELL_SIZE + 1, segment.y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
        ctx.shadowBlur = 0;
    });

    // Глаза головы
    const head = snake[0];
    if (head) {
        ctx.fillStyle = 'white';
        const eyeOffsets = {
            '1,0': [{x: 12, y: 5}, {x: 12, y: 13}],
            '-1,0': [{x: 6, y: 5}, {x: 6, y: 13}],
            '0,1': [{x: 5, y: 12}, {x: 13, y: 12}],
            '0,-1': [{x: 5, y: 6}, {x: 13, y: 6}]
        };
        const key = `${direction.dx},${direction.dy}`;
        const eyes = eyeOffsets[key] || eyeOffsets['1,0'];
        eyes.forEach(pos => {
            ctx.beginPath();
            ctx.arc(head.x * CELL_SIZE + pos.x, head.y * CELL_SIZE + pos.y, 2, 0, 2 * Math.PI);
            ctx.fill();
        });
    }
}

function updateStats() {
    document.getElementById('score').textContent = score;
    document.getElementById('best-score').textContent = bestScore;
    document.getElementById('steps').textContent = steps;
    document.getElementById('generation').textContent = generation;

    // Обновляем прогресс
    const progress = Math.min((steps / maxSteps) * 100, 100);
    document.getElementById('progressFill').style.width = progress + '%';
}

function updateBestScore() {
    if (score > bestScore) {
        bestScore = score;
        document.getElementById('best-score').textContent = bestScore;
    }
}

// ========== AI ЛОГИКА ==========
async function aiStep() {
    if (gameOver || isPaused) return;

    const state = ai.getState(snake, food);
    const action = await ai.predict(state);

    // Преобразуем действие в направление
    const actions = [
        { dx: 0, dy: -1 }, // вверх
        { dx: 0, dy: 1 },  // вниз
        { dx: -1, dy: 0 }, // влево
        { dx: 1, dy: 0 }   // вправо
    ];

    const newDir = actions[action];
    // Запрещаем разворот
    if (!(direction.dx === -newDir.dx && direction.dy === -newDir.dy)) {
        nextDirection = newDir;
    }

    update();
}

// ========== УПРАВЛЕНИЕ ОБУЧЕНИЕМ ==========
let trainingInterval = null;

async function startTraining() {
    if (isTraining) return;

    await ai.loadModel();
    isTraining = true;
    isPaused = false;
    generation++;

    initGame();
    draw();
    updateStats();

    if (trainingInterval) clearInterval(trainingInterval);
    trainingInterval = setInterval(async () => {
        if (!gameOver && !isPaused) {
            await aiStep();
        } else if (gameOver && isTraining) {
            // Рестарт при смерти
            generation++;
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
    generation = 0;
    initGame();
    draw();
    updateStats();
    document.getElementById('pauseBtn').textContent = '⏸ Пауза';
}

function toggleSpeed() {
    const speeds = [100, 50, 25, 150];
    const labels = ['1x', '2x', '4x', '0.5x'];
    let currentIndex = speeds.indexOf(speed);
    currentIndex = (currentIndex + 1) % speeds.length;
    speed = speeds[currentIndex];
    document.getElementById('speedBtn').textContent = `⚡ Скорость: ${labels[currentIndex]}`;

    if (isTraining) {
        clearInterval(trainingInterval);
        trainingInterval = setInterval(async () => {
            if (!gameOver && !isPaused) {
                await aiStep();
            } else if (gameOver && isTraining) {
                generation++;
                initGame();
                draw();
                updateStats();
            }
        }, speed);
    }
}

// ========== ЗАПУСК ==========
initGame();
draw();
updateStats();

// Пробуем загрузить модель при старте
ai.loadModel();

// Обработка клавиш для ручного управления (опционально)
document.addEventListener('keydown', (e) => {
    if (isTraining) return; // AI управляет

    const keyMap = {
        'ArrowUp': { dx: 0, dy: -1 },
        'ArrowDown': { dx: 0, dy: 1 },
        'ArrowLeft': { dx: -1, dy: 0 },
        'ArrowRight': { dx: 1, dy: 0 }
    };

    const newDir = keyMap[e.key];
    if (newDir && !(direction.dx === -newDir.dx && direction.dy === -newDir.dy)) {
        nextDirection = newDir;
    }
});

console.log('🐍 AI Snake загружен! Нажмите "Начать обучение"');