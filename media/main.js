// media/main.js
(function () {
    const vscode = acquireVsCodeApi();
    const diffInput = document.getElementById('diffInput');
    const createDiffViewButton = document.getElementById('createDiffViewButton');
    const applyToFileButton = document.getElementById('applyToFileButton'); // Новая кнопка
    const errorMessageDiv = document.getElementById('error-message');

    let lastKnownDiffText = ''; // Хранить последний текст для applyToFileButton

    diffInput.addEventListener('input', () => {
        lastKnownDiffText = diffInput.value;
        errorMessageDiv.textContent = ''; // Очистка ошибок при вводе
    });

    createDiffViewButton.addEventListener('click', () => {
        const diffText = diffInput.value;
        lastKnownDiffText = diffText; // Обновляем при нажатии
        errorMessageDiv.textContent = '';
        if (!diffText.trim()) {
            vscode.postMessage({ type: 'showError', message: 'Diff input is empty.' });
            return;
        }
        vscode.postMessage({
            type: 'applyDiff', // Это для создания визуального diff view
            value: diffText
        });
    });

    applyToFileButton.addEventListener('click', () => {
        // Используем текст из поля ввода, если он есть, иначе последний известный
        const diffText = diffInput.value.trim() ? diffInput.value : lastKnownDiffText;
        errorMessageDiv.textContent = '';
        if (!diffText.trim()) {
            vscode.postMessage({ type: 'showError', message: 'Diff input is empty. Create a diff view first or paste diff text.' });
            return;
        }
        vscode.postMessage({
            type: 'applyPatchToFile', // Новый тип сообщения
            value: diffText
        });
    });

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'parseError':
                errorMessageDiv.textContent = message.message;
                break;
            // Можно добавить другие обработчики сообщений от расширения
        }
    });
}());