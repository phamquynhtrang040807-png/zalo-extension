# Auto Zalo — TikTok Shop → Google Sheets → Zalo

Hệ thống gồm Chrome Extension Manifest V3 và backend FastAPI có hàng đợi bền vững. Bản mặc định chạy an toàn với Google Sheets tắt và Zalo `DRY_RUN=true`; vì vậy có thể kiểm tra toàn bộ luồng mà chưa gửi dữ liệu ra ngoài.

## 1. Chạy backend local bằng Docker

```powershell
Copy-Item .env.example .env
docker compose up --build -d
docker compose ps
Invoke-RestMethod http://localhost:8001/health
```

API tại `http://localhost:8001`, Swagger tại `http://localhost:8001/docs`. Thay `API_TOKEN` trong `.env` bằng chuỗi ngẫu nhiên dài trước khi sử dụng.

Để chạy với PostgreSQL trên VPS/Cloud:

```powershell
$env:POSTGRES_PASSWORD = "mat-khau-rat-manh"
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up --build -d
```

Cloud phải đặt sau reverse proxy HTTPS. Không công khai cổng API qua HTTP thuần.

## 2. Cài Chrome Extension

Build lại khi sửa TypeScript:

```powershell
Set-Location extension
npm.cmd install
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Sau đó mở `chrome://extensions`, bật **Developer mode**, chọn **Load unpacked** và trỏ tới thư mục `extension/dist`.

Mở **Extension options** rồi nhập:

- Backend URL: `http://localhost:8001`
- API token: giống `API_TOKEN` trong `.env`

Nút nổi chỉ hiện khi trang có dấu hiệu là trang chi tiết nhà sáng tạo và có GMV. Manifest hiện giới hạn ở các miền TikTok/TikTok Global Shop; khi có URL thật, hãy thu hẹp `matches` và `host_permissions` trong `extension/manifest.json` về đúng hostname đó. Nếu backend đặt trên Cloud, thêm origin HTTPS của backend vào `host_permissions` trước khi build lại extension.

## 3. Bật Google Sheets

1. Tạo Google Cloud service account, bật Google Sheets API và tải file JSON.
2. Chia sẻ spreadsheet cho email `client_email` trong JSON với quyền Editor.
3. Đặt file tại `backend/secrets/google-service-account.json`.
4. Cập nhật `.env`:

```dotenv
GOOGLE_SHEETS_ENABLED=true
GOOGLE_SPREADSHEET_ID=id-nam-giua-duong-link-google-sheet
GOOGLE_SHEET_NAME=Leads
```

Khởi động lại `api` và `worker`. Backend tự tạo hàng tiêu đề và luôn thêm dòng mới; dữ liệu trùng được giữ nguyên.

`GOOGLE_SPREADSHEET_ID` là đoạn ID trong URL `https://docs.google.com/spreadsheets/d/{ID}/edit`. `GOOGLE_SHEET_NAME` là tên **tab ở phía dưới file**, không phải tên file Google Sheet.

### Dùng Google OAuth thay cho service account

OAuth client ID/secret không được đặt trong extension. Chúng chỉ nằm trong `.env` của backend; backend lưu refresh token trong thư mục `backend/secrets` để worker tiếp tục ghi Sheet khi trình duyệt đã đóng.

```dotenv
GOOGLE_AUTH_MODE=oauth
GOOGLE_OAUTH_CLIENT_ID=client-id-moi-sau-khi-rotate
GOOGLE_OAUTH_CLIENT_SECRET=client-secret-moi-sau-khi-rotate
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8001/v1/integrations/google/callback
GOOGLE_SPREADSHEET_ID=id-trong-url
GOOGLE_SHEET_NAME=Leads
GOOGLE_SHEETS_ENABLED=false
```

Trong Google Cloud Console, thêm chính xác redirect URI trên vào OAuth client. Khởi động lại backend, mở Extension Options và thực hiện:

1. **Kết nối Google** → chọn tài khoản và đồng ý quyền Google Sheets.
2. Quay lại Options → **Kiểm tra Google Sheet**.
3. Chỉ khi kết quả có `connected: true`, đổi `GOOGLE_SHEETS_ENABLED=true` và khởi động lại backend/worker.

Kiểm tra quyền ghi tạo một tab tạm, ghi/đọc một marker rồi xóa tab ngay. Nếu cấu hình nhầm tên file thành tên tab, kết quả sẽ trả danh sách tab thực tế để sửa `GOOGLE_SHEET_NAME`.

## 4. Đăng nhập và gửi bằng tài khoản Zalo cá nhân

Service `zalo-bridge` dùng package `zca-js` được khóa phiên bản trong `zalo-bridge/package-lock.json`. Bridge lưu phiên đăng nhập trong Docker volume, tra số điện thoại thành UID rồi thực hiện kết bạn hoặc nhắn tin. Backend gọi bridge qua mạng Docker nội bộ:

```dotenv
ZALO_ENABLED=true
DRY_RUN=false
ZALO_BASE_URL=http://zalo-bridge:3005
ZALO_TOKEN=chuoi-bi-mat-dai
ZALO_FORCE_RECIPIENT_ENABLED=false
ZALO_FORCE_RECIPIENT_PHONE=0961382006
ZALO_FRIEND_REQUEST_MESSAGE=Chào bạn, mình là Trang Phạm, đến từ JUSTDUN - brand chuyên về thời trang nữ
ZALO_MESSAGE_TEMPLATE=Chào {username}, mình muốn trao đổi với bạn về cơ hội hợp tác.
```

Sau khi chạy `docker compose up --build -d`, reload Extension tại `chrome://extensions`, mở **Extension options** và dùng khối **Tài khoản Zalo cá nhân** ngay dưới Backend URL/API token. Bấm **Tạo QR đăng nhập**, quét QR bằng ứng dụng Zalo trên điện thoại và xác nhận. Giao diện sẽ hiển thị tên tài khoản khi phiên sẵn sàng. Phiên được tự khôi phục sau khi container khởi động lại; nếu Zalo làm hết hạn phiên thì quét lại QR. Trang `http://localhost:3005` vẫn có thể dùng như giao diện dự phòng.

Khối **Automation kết bạn và nhắn tin** cho phép sửa lời nhắn kết bạn, thêm/xóa tối đa 20 tin nhắn tự động, hoặc xóa hết tin nhắn để chỉ gửi lời mời. Cấu hình được lưu ở backend và áp dụng cho các job Zalo chưa hoàn tất. Các biến template: `{username}`, `{display_name}`, `{followers}`, `{gmv}`. Có thể tạm dừng ngay từ trang Options; worker giữ task trong hàng đợi và không tính lần retry khi đang tạm dừng. Mỗi tin nhắn có `idempotency_key` riêng để retry không gửi trùng.

Với `ZALO_FORCE_RECIPIENT_ENABLED=false`, backend và bridge dùng số điện thoại đã chuẩn hóa từ từng KOL để gửi lời mời kết bạn và các tin nhắn đã cấu hình. Chỉ bật lại biến này khi cần ép toàn bộ thao tác về một số kiểm thử duy nhất.

`zca-js` sử dụng giao thức tài khoản cá nhân không chính thức; thay đổi phía Zalo có thể làm phiên hết hạn hoặc API ngừng hoạt động, và tự động hóa có thể ảnh hưởng tài khoản. Giữ tốc độ gửi thấp và chỉ liên hệ người đã đồng ý nhận tin.

## 5. Điều chỉnh parser theo HTML thật

Parser nằm tại `extension/src/parser.ts`. Hãy bổ sung selector ổn định do trang cung cấp vào `SELECTORS`; fallback hiện tại đọc theo các nhãn `Người theo dõi`, `GMV`, số điện thoại và khoảng ngày tiếng Việt. Sau khi thay đổi, thêm HTML rút gọn vào `extension/tests/parser.test.ts`, chạy test và build lại.

Quy tắc nghiệp vụ đã triển khai:

- Không giới hạn GMV tối thiểu; Sheet giữ nguyên văn bản GMV đọc từ TikTok.
- Trường SĐT trống: lưu Sheet với `missing_phone`, không gọi Zalo; mọi giá trị SĐT không rỗng đều được chuyển tiếp, không chặn theo định dạng.
- Database dùng `profile_id`, fallback username để theo dõi trạng thái Zalo; Google Sheet luôn insert và chấp nhận dòng trùng.
- Sau khi dòng Sheet append thành công, worker tạo một lượt delivery mới: kết bạn trước rồi gửi lần lượt các tin nhắn đã cấu hình. Bấm thu thập lại sẽ tạo dòng Sheet và lượt delivery mới.
- Lời mời chạy trước, tin nhắn chạy ngay sau kết quả cuối của lời mời và không chờ chấp nhận kết bạn.
- Mỗi bước retry tối đa 3 lần; thành công từng bước được lưu độc lập.

## 6. Chạy kiểm thử backend không dùng Docker

```powershell
Set-Location backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe scripts\e2e_local.py
```
