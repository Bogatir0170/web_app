// Хранилище загруженных данных, чтобы быстро брать информацию для редактирования
let currentScheduleData = [];

// Динамический рендеринг расписания
async function loadSchedule() {
    const response = await fetch('/api/schedule');
    currentScheduleData = await response.json();
    const container = document.getElementById('schedule-container');
    container.innerHTML = '';

    // Группируем элементы по датам
    const groups = {};
    currentScheduleData.forEach(item => {
        if (!groups[item.date]) {
            groups[item.date] = { day: item.day_of_week, items: [] };
        }
        groups[item.date].items.push(item);
    });

    // Отрисовываем блоки дней
    Object.keys(groups).forEach(date => {
        const group = groups[date];
        const isVacantDay = group.items.some(i => i.student_name === 'ВАКАНТНО');
        const block = document.createElement('div');
        block.className = 'date-block';
        
        let rowsHtml = '';
        group.items.forEach(item => {
            const isVacant = item.student_name === 'ВАКАНТНО';
            const isShower = item.is_shower === 1;
            
            rowsHtml += `
                <div class="row-item ${isShower ? 'shower-type' : ''} ${isVacant ? 'vacant-type' : ''}">
                    <div class="row-label">• ${item.floor}</div>
                    <div class="row-content">
                        <div class="student-name">${item.student_name}</div>
                        ${!isVacant ? `<div class="student-sub"><span class="room">${item.room}</span>${item.group_code}</div>` : ''}
                    </div>
                    <div class="action-cell">
                        ${isVacant 
                            ? `<span class="icon-plus" onclick="openModal(${item.id})">+</span>` 
                            : `<span class="icon-check" style="cursor:pointer;" onclick="openModal(${item.id})" title="Редактировать">✓</span>`
                        }
                    </div>
                </div>
            `;
        });

        const vacantCount = group.items.filter(i => i.student_name === 'ВАКАНТНО').length;
        const badgeText = isVacantDay ? `${vacantCount} деж.` : 'ок';
        const badgeColor = isVacantDay ? '#8e8e93' : '#34c759';

        block.innerHTML = `
            <div class="date-header">
                <div class="date-text">${date} <span>${group.day}</span></div>
                <div class="badge" style="color: ${badgeColor}">${badgeText}</div>
            </div>
            ${rowsHtml}
        `;
        container.appendChild(block);
    });
}

// Логика модального окна формы
function openModal(id) { 
    document.getElementById('record-id').value = id; 
    
    // Ищем текущую запись в массиве данных, чтобы подставить в поля формы при редактировании
    const currentItem = currentScheduleData.find(item => item.id === id);
    
    if (currentItem && currentItem.student_name !== 'ВАКАНТНО') {
        document.getElementById('student-name').value = currentItem.student_name;
        document.getElementById('student-room').value = currentItem.room;
        document.getElementById('student-group').value = currentItem.group_code;
        document.querySelector('.modal-content h3').innerText = 'Редактирование дежурства';
    } else {
        // Если место было пустым, открываем чистую форму
        document.getElementById('student-name').value = '';
        document.getElementById('student-room').value = '';
        document.getElementById('student-group').value = '';
        document.querySelector('.modal-content h3').innerText = 'Запись на дежурство';
    }
    
    document.getElementById('modal').classList.add('active'); 
}

function closeModal() { 
    document.getElementById('modal').classList.remove('active'); 
}

async function submitForm() {
    const id = document.getElementById('record-id').value;
    const student_name = document.getElementById('student-name').value.trim();
    const room = document.getElementById('student-room').value.trim();
    const group_code = document.getElementById('student-group').value.trim();

    // Если поле не "ВАКАНТНО", то все поля должны быть заполнены
    if (student_name.toUpperCase() !== 'ВАКАНТНО' && (!student_name || !room || !group_code)) {
        return alert("Пожалуйста, заполните все поля формы! Для освобождения места напишите ВАКАНТНО.");
    }

    await fetch('/api/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, student_name, room, group_code })
    });
    
    closeModal(); 
    loadSchedule();
}

// Логика Веб-сокет виджета чата
const ws = new WebSocket('wss://' + window.location.host);

ws.onmessage = (event) => { 
    appendMessage(JSON.parse(event.data).text, 'operator'); 
};

function toggleWidget() { 
    document.getElementById('tg-window').classList.toggle('open'); 
}

function handleKeyPress(e) { 
    if (e.key === 'Enter') sendWidgetMessage(); 
}

function sendWidgetMessage() {
    const input = document.getElementById('tg-input');
    if (!input.value.trim()) return;
    
    appendMessage(input.value, 'user');
    ws.send(JSON.stringify({ text: input.value }));
    input.value = '';
}

function appendMessage(text, sender) {
    const msg = document.createElement('div');
    msg.className = `tg-msg ${sender}`;
    msg.innerText = text;
    
    const container = document.getElementById('tg-messages');
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
}

let allStudents = []; // Здесь храним список учащихся для автозаполнения

// 1. Загрузка списка студентов с сервера
async function loadStudentsForAutofill() {
    try {
        const response = await fetch('/api/students');
        allStudents = await response.json();
        console.log("Список студентов успешно загружен:", allStudents);
    } catch (error) {
        console.error("Ошибка загрузки студентов:", error);
    }
}

// Получаем элементы интерфейса для кастомных подсказок
const nameInput = document.getElementById('student-name');
const suggestionsBox = document.getElementById('suggestions-box');

// 2. Отслеживание ввода: фильтруем студентов «на лету» и выводим свой список
nameInput.addEventListener('input', function() {
    const query = this.value.trim().toLowerCase();
    suggestionsBox.innerHTML = ''; // Очищаем прошлые подсказки

    // ЕСЛИ СПИСОК ПУСТОЙ — ВЫВОДИМ ОШИБКУ ПРЯМО В ОКНО ПОДСКАЗОК
    if (allStudents.length === 0) {
        suggestionsBox.innerHTML = '<div class="suggestion-item" style="color:red; font-size:12px;">База студентов пуста или не загрузилась</div>';
        suggestionsBox.style.display = 'block';
        return;
    }

    if (!query) {
        suggestionsBox.style.display = 'none';
        return;
    }

    // Ищем совпадения по введенным буквам
    const filtered = allStudents.filter(student => 
        student.name.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
        suggestionsBox.innerHTML = '<div class="suggestion-item" style="color:#8e8e93;">Студент не найден в базе</div>';
        suggestionsBox.style.display = 'block';
        return;
    }

    // Создаем элементы списка для каждого найденного студента
    filtered.forEach(student => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.innerText = student.name;
        
        div.onclick = function() {
            nameInput.value = student.name;
            document.getElementById('student-room').value = student.room;
            document.getElementById('student-group').value = student.group_code;
            suggestionsBox.style.display = 'none'; 
        };
        
        suggestionsBox.appendChild(div);
    });

    suggestionsBox.style.display = 'block'; 
});

// Закрываем меню подсказок, если кликнули в любое другое место экрана
document.addEventListener('click', function(e) {
    if (e.target !== nameInput && e.target !== suggestionsBox) {
        suggestionsBox.style.display = 'none';
    }
});

// 3. Обновляем событие загрузки страницы
window.onload = function() {
    loadSchedule();
    loadStudentsForAutofill(); // Загружаем список студентов при старте приложения
};


