# Auto Compare Video Studio

Studio desktop tạo video so sánh kiến thức bằng React và Remotion. Người dùng có thể mở project mẫu, chỉnh nội dung, preview và render MP4 ngay trên Windows.

## Project mẫu

Project mẫu duy nhất được chia sẻ trong repository:

[`videos/day-la-adn-day-la-gen/`](videos/day-la-adn-day-la-gen/)

Project này là video dọc 1080×1920 về sự khác nhau giữa ADN và gen, có hình minh họa, phụ đề và voiceover mẫu.

## Cài và chạy trên Windows

1. Cài Node.js 18 trở lên một lần: <https://nodejs.org/en/download>
2. Tải repository về máy.
3. Bấm đúp `setup.bat`. File này tự kiểm tra/cài Git nếu thiếu, tự tạo `.env` từ `.env.example` và chạy `npm install` để cài thư viện.
4. Bấm đúp `start-studio.bat` để mở ứng dụng.

`node_modules/`, `.env`, API key, file tạm, render và project video riêng không nằm trong repository. API key chỉ điền trong `.env` trên máy cần tạo voiceover mới.

## Cập nhật code từ Git

Khi mở bằng `start-studio.bat` hoặc `npm.cmd run app`, app sẽ kiểm tra `origin/main` lúc khởi động và định kỳ. Nếu GitHub có commit mới, thanh trên cùng sẽ hiện nút `Có bản mới`.

Bấm nút đó để app tải code mới, chạy `npm install` nếu file thư viện thay đổi, rồi tự mở lại bằng bản mới. App không cập nhật nếu thư mục đang có file sửa cục bộ để tránh ghi đè code hoặc dữ liệu của bạn.

## Lệnh chính

Từ thư mục gốc:

```powershell
npm.cmd run studio       # chạy Studio local
npm.cmd test             # chạy test backend và AIMAX
npm.cmd run build:studio # build giao diện Studio
```

Từ thư mục project video:

```powershell
cd videos/day-la-adn-day-la-gen
npm.cmd run check        # kiểm tra composition Remotion
npm.cmd run render       # render MP4 vào renders/
```

Các lệnh kiểm tra và render của project đều gọi `scripts/remotion-render-video.mjs` và renderer trong `studio/backend/services/remotionRenderer.mjs`.

## Cấu trúc chính

```text
app/                         Electron launcher
remotion/                    Remotion composition và player
studio/                      Backend, frontend và test của Studio
shared/                      Runtime helpers dùng chung
shared-assets/               Font, SFX và character assets đã xử lý
videos/day-la-adn-day-la-gen/Project mẫu
setup.bat                    Cài môi trường lần đầu trên Windows
start-studio.bat             Mở ứng dụng
```

## Bảo mật và file không commit

- Không commit `.env` hoặc API key.
- Không commit `node_modules/`.
- Không commit jobs, renders, snapshots, cache, upload cá nhân hoặc video gốc nặng.
- Chỉ project mẫu được mở khóa trong `.gitignore`; các project video khác vẫn ở máy local.

## License

[MIT](LICENSE)
