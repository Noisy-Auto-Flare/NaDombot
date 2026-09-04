# Используем официальный образ Node.js
FROM node:20-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json (если есть)
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install --omit=dev

# Копируем остальные файлы приложения
COPY . .

# Создаем пользователя для безопасности
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Создаем директорию для данных SQLite с правильными правами
RUN mkdir -p /app/data && \
    chown -R nodejs:nodejs /app

# Переключаемся на пользователя nodejs
USER nodejs

# Открываем порт (если нужен)
# EXPOSE 3000

# Запускаем приложение
CMD ["node", "src/index.js"]
