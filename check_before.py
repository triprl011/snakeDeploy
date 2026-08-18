#!/usr/bin/env python
# check_before_push.py - Проверка модели перед git push

import os
import sys
import json
import subprocess


def check_model_files():
    """Проверяет наличие всех необходимых файлов"""
    required_files = [
        'model.onnx',
        'model_config.json',
        'training_history.json',
        'validation_info.json',
        'index.html',
        'script.js',
        'style.css'
    ]

    print("📁 Проверка файлов...")
    missing = []
    for file in required_files:
        if os.path.exists(file):
            size = os.path.getsize(file) if os.path.isfile(file) else 0
            if os.path.isfile(file) and size > 0:
                print(f"  ✅ {file} ({size} bytes)")
            elif os.path.isdir(file):
                print(f"  ✅ {file} (директория)")
            else:
                print(f"  ⚠️ {file} (пустой файл)")
        else:
            print(f"  ❌ {file} ОТСУТСТВУЕТ!")
            missing.append(file)

    if missing:
        print(f"\n❌ Отсутствуют файлы: {', '.join(missing)}")
        return False

    return True


def check_model_quality():
    """Проверяет качество модели через validation_info.json"""
    if not os.path.exists('validation_info.json'):
        print("❌ validation_info.json не найден! Модель не проверена.")
        return False

    try:
        with open('validation_info.json', 'r') as f:
            info = json.load(f)

        print("\n📊 Информация о модели:")
        print(f"  Средний счет: {info.get('avg_score', 0):.1f}")
        print(f"  Лучший счет: {info.get('best_score', 0)}")
        print(f"  Эпизодов: {info.get('num_episodes', 0)}")
        print(f"  Время сохранения: {info.get('timestamp', 'unknown')}")

        if info.get('avg_score', 0) < 3:
            print("❌ Модель слишком слабая! (средний счет < 3)")
            return False

        print("✅ Качество модели приемлемое")
        return True

    except Exception as e:
        print(f"❌ Ошибка чтения validation_info.json: {e}")
        return False


def check_onnx_file():
    """Проверяет размер и валидность ONNX файла"""
    if not os.path.exists('model.onnx'):
        print("❌ model.onnx не найден!")
        return False

    size = os.path.getsize('model.onnx') / 1024
    print(f"\n📦 Размер model.onnx: {size:.2f} KB")

    if size < 10:
        print("❌ model.onnx слишком маленький! Возможно поврежден.")
        return False

    if size > 10000:
        print(f"⚠️ model.onnx очень большой ({size:.2f} KB)")
        print("   Рекомендуется оптимизировать модель")

    print("✅ model.onnx в порядке")
    return True


def run_validation():
    """Запускает валидацию модели через train_snake.py"""
    print("\n🧪 Запуск валидации модели...")
    result = subprocess.run(
        ['python', 'train_snake.py', '--validate'],
        capture_output=True,
        text=True
    )

    if result.returncode == 0:
        print("✅ Валидация пройдена!")
        return True
    else:
        print("❌ Валидация не пройдена!")
        if result.stderr:
            print(result.stderr)
        return False


def check_git_status():
    """Проверяет git статус"""
    print("\n🔍 Проверка Git статуса...")
    result = subprocess.run(['git', 'status', '--porcelain'], capture_output=True, text=True)

    if result.stdout:
        print("📝 Измененные файлы:")
        for line in result.stdout.split('\n'):
            if line:
                print(f"  {line}")
    else:
        print("✅ Нет изменений")

    return True


def main():
    print("=" * 60)
    print("🔍 ПРОВЕРКА ПЕРЕД PUSH")
    print("=" * 60)

    # Список проверок
    checks = [
        ("Файлы", check_model_files),
        ("ONNX файл", check_onnx_file),
        ("Качество модели", check_model_quality),
        ("Git статус", check_git_status)
    ]

    failed = False
    for name, check_func in checks:
        print(f"\n--- {name} ---")
        if not check_func():
            failed = True

    if failed:
        print("\n" + "=" * 60)
        print("❌ ПРОВЕРКИ НЕ ПРОЙДЕНЫ! PUSH ОТМЕНЕН")
        print("=" * 60)
        print("\nРешение проблем:")
        print("  1. Запустите: python train_snake.py")
        print("  2. Или: python train_snake.py --force (для принудительного сохранения)")
        print("  3. Проверьте наличие всех файлов")
        sys.exit(1)

    print("\n" + "=" * 60)
    print("✅ ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ! МОЖНО ДЕЛАТЬ PUSH")
    print("=" * 60)
    sys.exit(0)


if __name__ == "__main__":
    main()