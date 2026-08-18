// ========== ЗАГРУЗКА ИСТОРИИ (с отладкой) ==========
async function loadTrainingHistory() {
    try {
        console.log('🔄 Загрузка training_history.json...');
        const response = await fetch('training_history.json');

        if (!response.ok) {
            console.warn('❌ training_history.json не найден (статус:', response.status, ')');
            // Создаем тестовые данные для демонстрации
            createDemoData();
            return;
        }

        const data = await response.json();
        console.log('📊 Получены данные:', data);
        console.log('   - scores:', data.scores ? data.scores.length : 0, 'записей');
        console.log('   - losses:', data.losses ? data.losses.length : 0, 'записей');
        console.log('   - rewards:', data.rewards ? data.rewards.length : 0, 'записей');

        if (!data.scores || data.scores.length === 0) {
            console.warn('⚠️ Нет данных в training_history.json');
            createDemoData();
            return;
        }

        const generations = data.scores.map((_, i) => i + 1);

        history.generations = generations;
        history.scores = data.scores;
        history.losses = data.losses || [];
        history.rewards = data.rewards || [];

        // Вычисляем статистику
        let best = 0;
        const bestScores = [];
        const avgScores = [];
        const avgLosses = [];

        for (let i = 0; i < data.scores.length; i++) {
            if (data.scores[i] > best) best = data.scores[i];
            bestScores.push(best);

            const start = Math.max(0, i - 9);
            const slice = data.scores.slice(start, i + 1);
            const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
            avgScores.push(avg);

            if (data.losses && data.losses.length > 0) {
                const lossSlice = data.losses.slice(start, i + 1);
                const avgLoss = lossSlice.reduce((a, b) => a + b, 0) / lossSlice.length;
                avgLosses.push(avgLoss);
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
        console.error('❌ Ошибка загрузки истории:', error);
        createDemoData();
    }
}

// ========== СОЗДАНИЕ ДЕМО-ДАННЫХ ДЛЯ ГРАФИКОВ ==========
function createDemoData() {
    console.log('📊 Создаем демо-данные для графиков...');

    // Генерируем данные для демонстрации
    const demoCount = 50;
    const scores = [];
    const losses = [];
    const rewards = [];
    const generations = [];

    let best = 0;
    for (let i = 0; i < demoCount; i++) {
        generations.push(i + 1);

        // Счет: постепенно растет с шумом
        const score = Math.floor(Math.random() * 5 + i * 0.3);
        scores.push(score);
        if (score > best) best = score;

        // Loss: постепенно уменьшается
        losses.push(Math.max(0.1, 1.0 - i * 0.015 + Math.random() * 0.1));

        // Награда: растет со счетом
        rewards.push(score * 20 + Math.random() * 50 - 25);
    }

    // Вычисляем статистику
    const bestScores = [];
    const avgScores = [];
    const avgLosses = [];

    for (let i = 0; i < scores.length; i++) {
        const start = Math.max(0, i - 9);
        const slice = scores.slice(start, i + 1);
        const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
        avgScores.push(avg);

        const lossSlice = losses.slice(start, i + 1);
        const avgLoss = lossSlice.reduce((a, b) => a + b, 0) / lossSlice.length;
        avgLosses.push(avgLoss);

        // Обновляем лучший
        if (i === 0) {
            bestScores.push(scores[0]);
        } else {
            bestScores.push(Math.max(bestScores[i-1], scores[i]));
        }
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