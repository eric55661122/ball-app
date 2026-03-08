# 球帳管理系統 - 部署說明

## 專案結構
```
ball-app/
├── server.js          # 後端 API (Express + SQLite)
├── package.json
├── ecosystem.config.js # PM2 設定
├── nginx.conf         # Nginx 設定範本
├── data/              # 自動建立，存放 ball.db
└── public/
    └── index.html     # 前端
```

---

## 部署步驟

### 1. 上傳專案到伺服器
```bash
scp -r ball-app/ user@你的IP:/home/user/ball-app
```

### 2. 安裝 Node.js（如果還沒有）
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v  # 確認安裝成功
```

### 3. 安裝 PM2（背景執行）
```bash
sudo npm install -g pm2
```

### 4. 安裝專案依賴
```bash
cd /home/user/ball-app
npm install
```

### 5. 設定環境變數
編輯 `ecosystem.config.js`，修改：
- `JWT_SECRET`：改成隨機字串（越長越安全）
- `DB_PATH`：改成你的完整路徑

### 6. 啟動應用
```bash
pm2 start ecosystem.config.js
pm2 save           # 儲存設定
pm2 startup        # 設定開機自動啟動（按照輸出的指令執行）
```

常用 PM2 指令：
```bash
pm2 status         # 查看狀態
pm2 logs ball-accounting  # 看 log
pm2 restart ball-accounting
pm2 stop ball-accounting
```

### 7. 設定 Nginx
```bash
sudo nano /etc/nginx/sites-available/ball
# 貼入 nginx.conf 的內容，修改 domain

sudo ln -s /etc/nginx/sites-available/ball /etc/nginx/sites-enabled/
sudo nginx -t      # 測試設定
sudo systemctl reload nginx
```

### 8. 申請 SSL 憑證（免費 HTTPS）
```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d 你的domain.com
```

### 9. 首次使用
1. 打開 `https://你的domain.com`
2. 看到「首次使用，請建立管理員帳號」
3. 輸入帳號密碼，點「建立帳號」
4. 再用同樣帳號密碼登入

---

## 備份資料庫
```bash
# 手動備份 SQLite 資料庫
cp /home/user/ball-app/data/ball.db /backup/ball-$(date +%Y%m%d).db

# 設定每天自動備份（crontab）
crontab -e
# 加入這行（每天凌晨3點備份）：
# 0 3 * * * cp /home/user/ball-app/data/ball.db /backup/ball-$(date +\%Y\%m\%d).db
```

---

## 更新前端
只需替換 `public/index.html` 再重啟：
```bash
pm2 restart ball-accounting
```
