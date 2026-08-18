// ========== КОНФИГУРАЦИЯ ==========
const GRID_SIZE = 12;  // УМЕНЬШИЛИ!
const CELL_SIZE = 30;  // 360/12 = 30px
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ... остальные переменные ...

// ========== ДАННЫЕ ДЛЯ ГРАФИКОВ ==========
const history = {
    scores: [],
    rewards: [],
    generations: [],
    avgScores: [],
    bestScores: [],
    qLosses: [],    // Q-Loss
    vLosses: [],    // Value Loss
    totalLosses: [] // Total Loss
};

// ========== ИНИЦИАЛИЗАЦИЯ ГРАФИКОВ ==========
function initCharts() {
    // График счетов (как раньше)
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
                    label: 'Средний (10)',
                    data: [],
                    borderColor: '#f39c12',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.3,
                    borderDash: [5, 5]
                },
                {
                    label: 'Лучший',
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
                    labels: { font: { size: 10 }, boxWidth: 12 }
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
                    title: { display: true, text: 'Счет' }
                },
                x: {
                    title: { display: true, text: 'Поколение' },
                    ticks: { maxTicksLimit: 30 }
                }
            }
        }
    });

    // График потерь (Q-Loss и Value Loss)
    const ctx2 = document.getElementById('lossChart').getContext('2d');
    lossChart = new Chart(ctx2, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Q-Loss',
                    data: [],
                    borderColor: '#e74c3c',
                    backgroundColor: 'rgba(231, 76, 60, 0.1)',
                    borderWidth: 2,
                    pointRadius: 1,
                    tension: 0.3,
                    fill: true
                },
                {
                    label: 'Value Loss',
                    data: [],
                    borderColor: '#3498db',
                    backgroundColor: 'rgba(52, 152, 219, 0.1)',
                    borderWidth: 2,
                    pointRadius: 1,
                    tension: 0.3,
                    fill: true
                },
                {
                    label: 'Epsilon',
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
                    labels: { font: { size: 10 }, boxWidth: 12 }
                },
                title: {
                    display: true,
                    text: '🎯 Q-Loss и Value Loss',
                    font: { size: 12 }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    position: 'left',
                    title: { display: true, text: 'Loss' }
                },
                y1: {
                    beginAtZero: true,
                    position: 'right',
                    max: 1,
                    title: { display: true, text: 'Epsilon' },
                    grid: { drawOnChartArea: false }
                },
                x: {
                    title: { display: true, text: 'Поколение' },
                    ticks: { maxTicksLimit: 30 }
                }
            }
        }
    });
}

let lossChart;

// ========== ДОБАВЛЕНИЕ ДАННЫХ С LOSS ==========
function addTrainingData(score, reward, eps, losses = null) {
    generation++;

    history.generations.push(generation);
    history.scores.push(score);
    history.rewards.push(reward);
    history.epsilonHistory = history.epsilonHistory || [];
    history.epsilonHistory.push(eps);

    if (losses) {
        history.qLosses.push(losses.q_loss || 0);
        history.vLosses.push(losses.v_loss || 0);
        history.totalLosses.push(losses.total_loss || 0);
    } else {
        history.qLosses.push(0);
        history.vLosses.push(0);
        history.totalLosses.push(0);
    }

    if (score > bestScore) {
        bestScore = score;
    }
    history.bestScores.push(bestScore);

    const last10 = history.scores.slice(-10);
    const avg = last10.reduce((a, b) => a + b, 0) / last10.length;
    history.avgScores.push(avg);

    document.getElementById('best-score').textContent = bestScore;
    document.getElementById('avg-score').textContent = avg.toFixed(1);
    document.getElementById('epsilon').textContent = eps.toFixed(3);
    document.getElementById('generation').textContent = generation;

    updateCharts();
}

function updateCharts() {
    const labels = history.generations;

    // Обновляем график счетов
    scoreChart.data.labels = labels;
    scoreChart.data.datasets[0].data = history.scores;
    scoreChart.data.datasets[1].data = history.avgScores;
    scoreChart.data.datasets[2].data = history.bestScores;
    scoreChart.update('none');

    // Обновляем график потерь
    if (lossChart) {
        lossChart.data.labels = labels;
        lossChart.data.datasets[0].data = history.qLosses;
        lossChart.data.datasets[1].data = history.vLosses;
        lossChart.data.datasets[2].data = history.epsilonHistory || [];
        lossChart.update('none');
    }
}

// ========== ИГРА (обновлена для 12x12) ==========
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
              Math.abs(pos.x - snake[0].x) + Math.abs(pos.y - snake[0].y) < 2) &&
              attempts < 50);
    food = pos;
}

// ========== ОБНОВЛЕННАЯ ОТРИСОВКА ==========
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

    // Еда (увеличенная)
    ctx.fillStyle = '#ff6b6b';
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#ff6b6b';
    ctx.beginPath();
    ctx.arc(food.x * CELL_SIZE + CELL_SIZE/2, food.y * CELL_SIZE + CELL_SIZE/2, CELL_SIZE/2 - 1, 0, 2 * Math.PI);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Змейка
    snake.forEach((segment, index) => {
        const gradient = ctx.createRadialGradient(
            segment.x * CELL_SIZE + 4, segment.y * CELL_SIZE + 4, 2,
            segment.x * CELL_SIZE + 15, segment.y * CELL_SIZE + 15, 15
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

// ========== ОСТАЛЬНОЙ КОД ==========
// ... (остальные функции остаются теми же, только GRID_SIZE = 12)