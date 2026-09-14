const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const WebSocket = require('ws');
const { Bot } = require('grammy');
const path = require('path');

// ==========================================
// НАСТРОЙКИ ВАШЕГО TELEGRAM БОТА
// ==========================================
const BOT_TOKEN = '8927846410:AAHT_uIpBf6Asj6aZcRLLkkweyPyToN9l1Q'; 
const ADMIN_CHAT_ID = 1715184803; 

const bot = new Bot(BOT_TOKEN);
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
// Отдаем файлы из папки public автоматически
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// БАЗА ДАННЫХ SQLITE (Данные со скриншота)
// ==========================================
const db = new sqlite3.Database('./dormitory.db');

// Внутри db.serialize(() => { ... }) допишите создание таблицы студентов:
db.serialize(() => {
    // Старая таблица schedule остается без изменений...
    db.run(`CREATE TABLE IF NOT EXISTS schedule (
        id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, day_of_week TEXT, floor TEXT, student_name TEXT, room TEXT, group_code TEXT, is_shower INTEGER DEFAULT 0, is_done INTEGER DEFAULT 0
    )`);

    // НОВАЯ ТАБЛИЦА: Список всех учащихся для автозаполнения
    db.run(`CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        room TEXT,
        group_code TEXT
    )`);

    // Заполняем базу студентов тестовыми данными, если она пуста
    db.get("SELECT COUNT(*) as count FROM students", (err, row) => {
        if (row.count === 0) {
            const stmt = db.prepare("INSERT INTO students (name, room, group_code) VALUES (?, ?, ?)");
            stmt.run("Костюкевич Николай Николаевич", "к.416", "6К9092");
            stmt.run("Кулеш Ярослав Денисович", "к.420", "6К9191");
            stmt.run("Дудко Захар Сергеевич", "к.404", "6К9691");
            stmt.run("Петров Иван Иванович", "к.412", "6К9192");
            stmt.run("Сидоров Алексей Владимирович", "к.415", "6К9092");
            stmt.finalize();
        }
    });
});

// НОВЫЙ API МАРШРУТ: Получить список всех студентов для подсказок
app.get('/api/students', (req, res) => {
    db.all("SELECT name, room, group_code FROM students ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
    db.get("SELECT COUNT(*) as count FROM schedule", (err, row) => {
        if (row.count === 0) {
            const stmt = db.prepare(`
                INSERT INTO schedule (
                    date, day_of_week, floor, student_name, room, group_code, is_shower, is_done
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            // 10.09.2026
            stmt.run("10.09.2026", "ЧТ", "4 этаж", "Костюкевич Николай Николаевич", "к.416", "6К9092", 0, 1);
            stmt.run("10.09.2026", "ЧТ", "Душ", "Кулеш Ярослав Денисович", "к.420", "6К9191", 1, 1);
            
            // 11.09.2026
            stmt.run("11.09.2026", "ПТ", "4 этаж", "ВАКАНТНО", "", "", 0, 0);
            stmt.run("11.09.2026", "ПТ", "Душ", "ВАКАНТНО", "", "", 1, 0);
            
            // 12.09.2026
            stmt.run("12.09.2026", "СБ", "4 этаж", "Дудко Захар Сергеевич", "к.404", "6К9691", 0, 1);
            stmt.run("12.09.2026", "СБ", "Душ", "ВАКАНТНО", "", "", 1, 0);
            
            // 13.09.2026
            stmt.run("13.09.2026", "ВС", "4 этаж", "ВАКАНТНО", "", "", 0, 0);
            stmt.run("13.09.2026", "ВС", "Душ", "ВАКАНТНО", "", "", 0, 0);
            
            stmt.finalize();
        }
    });
});

// API Маршруты
app.get('/api/schedule', (req, res) => {
    db.all("SELECT * FROM schedule ORDER BY id ASC", [], (err, rows) => {
        res.json(rows);
    });
});

app.post('/api/assign', (req, res) => {
    const { id, student_name, room, group_code } = req.body;
    
    // Если имя стёрли или написали ВАКАНТНО, сбрасываем поля
    const isVacant = !student_name || student_name.trim().toUpperCase() === 'ВАКАНТНО';
    
    const final_name = isVacant ? 'ВАКАНТНО' : student_name.trim();
    const final_room = isVacant ? '' : room.trim();
    const final_group = isVacant ? '' : group_code.trim();
    const final_done = isVacant ? 0 : 1;

    db.run(
        `UPDATE schedule 
         SET student_name = ?, room = ?, group_code = ?, is_done = ? 
         WHERE id = ?`, 
        [final_name, final_room, final_group, final_done, id], 
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// ==========================================
// ЛОГИКА АВТОНОМНОГО ЧАТ-ВИДЖЕТА
// ==========================================
const activeClients = new Map();

wss.on('connection', (ws) => {
    const clientId = Date.now().toString();
    activeClients.set(clientId, ws);

    ws.on('message', async (message) => {
        const data = JSON.parse(message);
        try {
            await bot.api.sendMessage(
                ADMIN_CHAT_ID, 
                `💬 Сообщение из виджета!\nID сессии: \`${clientId}\`\n\nТекст: ${data.text}`, 
                { parse_mode: "Markdown" }
            );
        } catch (e) { 
            console.error("Ошибка бота:", e); 
        }
    });

    ws.on('close', () => activeClients.delete(clientId));
});

bot.on('message:text', (ctx) => {
    if (ctx.chat.id !== ADMIN_CHAT_ID) return;
    
    const reply = ctx.message.reply_to_message;
    if (!reply || !reply.text.includes('ID сессии:')) return;
    
    const match = reply.text.match(/ID сессии:\s*(\d+)/);
    if (match) {
        const clientId = match[1];
        const clientWs = activeClients.get(clientId);
        
        if (clientWs && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ text: ctx.message.text }));
            ctx.reply('✅ Ответ отправлен в чат-виджет.');
        } else {
            ctx.reply('❌ Пользователь уже закрыл страницу.');
        }
    }
});

// Запуск
bot.start();
server.listen(3000, () => console.log('Сервер успешно запущен на порту 3000!'));
