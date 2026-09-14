let currentScheduleData = [];
let allStudents = [];

// 1. Загрузка основного расписания дежурств
async function loadSchedule() {
    try {
        const response = await fetch('/api/schedule');
        currentScheduleData = await response.json();
        const container = document.getElementById('schedule-container');
        if (!container) return;
        container.innerHTML = '';

        const groups = {};
        currentScheduleData.forEach(item => {
            if (!groups[item.date]) groups[item.date] = { day: item.day_of_week, items: [] };
            groups[item.date].items.push(item);
        });

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
                                : `<span class="icon-check" style="cursor:pointer;" onclick="openModal(${item.id})">✓</span>`
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
    } catch (e) {
        console.error("Ошибка загрузки расписания:", e);
    }
}

// 2. Загрузка списка студентов для автозаполнения
async function loadStudentsForAutofill() {
    try {
        const response = await fetch('/api/students');
        allStudents = await response.json();
    } catch (e) {
        console.error("Ошибка загрузки студентов:", e);
    }
}

// 3. Управление модальным окном
function openModal(id) { 
    document.getElementById('record-id').value = id; 
    const currentItem = currentScheduleData.find(item => item.id === id);
    
    if (currentItem && currentItem.student_name !== 'ВАКАНТНО') {
        document.getElementById('student-name').value = currentItem.student_name;
        document.getElementById('student-room').value = currentItem.room;
        document.getElementById('student-group').value = currentItem.group_code;
        document.querySelector('.modal-content h3').innerText = 'Редактирование дежурства';
    } else {
        document.getElementById('student-name').value = '';
        document.getElementById('student-room').value = '';
        document.getElementById('student-group').value = '';
        document.querySelector('.modal-content h3').innerText = 'Запись на дежурство';
    }
    
    // При открытии модалки всегда прячем блок подсказок
    document.getElementById('suggestions-box').style.display = 'none';
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

    if (student_name.toUpperCase() !== 'ВАКАНТНО' && (!student_name || !room || !group_code)) {
        return alert("Заполните все поля!");
    }

    await fetch('/api/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, student_name, room, group_code })
    });
    
    closeModal(); 
    loadSchedule();
}

// 4. Логика кастомных подсказок (ПОЛНОСТЬЮ АВТОНОМНАЯ)
function initAutofillLogic() {
    const nameInput = document.getElementById('student-name');
    const suggestionsBox = document.getElementById('suggestions-box');
    
    if (!nameInput || !suggestionsBox) return;

    nameInput.addEventListener('input', function() {
        const query = this.value.trim().toLowerCase();
        suggestionsBox.innerHTML = ''; 

        if (allStudents.length === 0) {
            suggestionsBox.innerHTML = '<div class="suggestion-item" style="color:red;">База студентов не загрузилась</div>';
            suggestionsBox.style.display = 'block';
            return;
        }

        if (!query) {
            suggestionsBox.style.display = 'none';
            return;
        }

        const filtered = allStudents.filter(student => 
            student.name.toLowerCase().includes(query)
        );

        if (filtered.length === 0) {
            suggestionsBox.innerHTML = '<div class="suggestion-item" style="color:#8e8e93;">Студент не найден</div>';
            suggestionsBox.style.display = 'block';
            return;
        }

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

    document.addEventListener('click', function(e) {
        if (e.target !== nameInput && e.target !== suggestionsBox) {
            suggestionsBox.style.display = 'none';
        }
    });
}

// 5. Логика чат-виджета
const ws = new WebSocket('wss://' + window.location.host);
ws.onmessage = (event) => { appendMessage(JSON.parse(event.data).text, 'operator'); };
function toggleWidget() { document.getElementById('tg-window').classList.toggle('open'); }
function handleKeyPress(e) { if (e.key === 'Enter') sendWidgetMessage(); }
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
    if (container) {
        container.appendChild(msg);
        container.scrollTop = container.scrollHeight;
    }
}

// Главная инициализация приложения при старте страницы
window.onload = async function() {
    await loadSchedule();
    await loadStudentsForAutofill(); 
    initAutofillLogic(); // Запускаем отслеживание ввода букв
};
