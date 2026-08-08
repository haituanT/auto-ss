# Hướng Dẫn Dùng Auto Compare Video Studio

## 1. Chuẩn Bị Tài Nguyên

Mở tab **Nguồn Tài Nguyên**.

- Upload **Tay chỉ trái** cho pose `point-left`.
- Upload **Tay chỉ phải** cho pose `point-right`.
- Upload **Đặt câu hỏi** cho pose `question`.
- Upload **Nền giấy** nếu muốn thay background.
- Upload **Audio test** nếu muốn dùng một MP3 mẫu để test pipeline.

Sau khi upload, bên phải sẽ xem được tài nguyên ngay. Nếu muốn video đang chọn dùng bộ mới, bấm **Áp dụng vào video đang chọn**.

## 2. Tạo Video

Mở tab **Tạo Video**.

- Nhập **Khái niệm A**.
- Nhập **Khái niệm B**.
- Nhập **Góc so sánh**.
- Nhập **Nội dung / kịch bản từng câu**.

Nếu muốn tool tự làm hết, bấm **Tự động làm video**. Studio sẽ tự chạy:

```text
tài nguyên đã upload + content
→ tạo data video
→ tạo ảnh A/B
→ lấy content gọi AIMAX TTS
→ check
→ render MP4 bằng Remotion
→ hiện ở Output
```

Đây là chế độ tự động tạo project Remotion, được đưa thành nút bấm trong UI.

Mỗi dòng trong nội dung sẽ thành một câu trong `video.json`.

Ví dụ:

```text
Đây là sấm.
Đây là chớp.
Khác nhau là gì?
Sấm là âm thanh mình nghe được sau tia chớp.
Chớp là ánh sáng lóe lên trước khi có tiếng sấm.
```

Có thể ép pose bằng tiền tố:

```text
[point-left] Đây là sấm.
[point-right] Đây là chớp.
[question] Khác nhau là gì?
```

## 3. Chọn Audio

Có 2 cách:

### Cách 1: Audio Có Sẵn

Bấm **Audio có sẵn** rồi upload file MP3/WAV. Studio sẽ dùng file đó làm audio chính của video và tự chia caption theo độ dài audio.

### Cách 2: Content → AIMAX TTS

Bấm **Content → AIMAX TTS** hoặc **Tạo VO AIMAX**. Studio gửi toàn bộ dòng content trong `video.json` vào một AIMAX batch, nhận audio đã tách dòng, đo duration bằng FFprobe rồi dựng timeline theo từng câu.

## 4. Preview Cũ

Mở tab **Preview cũ** hoặc bấm **Preview** trong Tạo Video.

Studio sẽ tự mở preview HTML cũ nếu cần xem nhanh. Render chính hiện dùng Remotion.

## 5. Check Và Render

Sau preview:

1. Bấm **Check** để kiểm tra layout, runtime, motion, contrast.
2. Nếu pass, bấm **Render MP4**.
3. Mở tab **Output** để xem video ngay trên Studio hoặc bấm **Tải về**.

## 6. Cấu Trúc File

Mỗi video vẫn có thư mục riêng, còn MP4 được render bằng Remotion:

```text
videos/<slug>/
├── index.html
├── video.json
├── assets/
│   ├── character/
│   ├── backgrounds/
│   ├── vo/
│   ├── compare-left.png
│   └── compare-right.png
└── renders/
```

Lõi repo hiện dùng Studio local và Remotion: `npm.cmd run studio`, `npm.cmd run remotion:studio`.
## 7. Mau goc va project rieng

Mau `full` chi luu phan style/he thong: phu de, nhan vat, am thanh mau, bo cuc, nen/logo va cau hinh render. Mau khong luu noi dung cau thoai, nhan A/B, anh A/B, crop/zoom/rotation, anh AI, voiceover, SRT, duration, word timing, preview hoac trang thai job/runtime.

Khi tao project tu mau, asset duoc copy rieng vao thu muc version cua project:

```text
studio-templates/full/<template-id>/
videos/<slug>/assets/template/<template-id>/v<version>/
```

Xoa hoac thay asset trong mot project khong lam doi mau goc hay project khac. `video.json` cua project phai tro vao asset trong chinh project, khong tro nguoc vao `studio-templates`.

## 8. Cap nhat mau

Project lien ket mau luon hien version dang dung. Nut `Cap nhat mau` chi sang khi backend tim thay thay doi trong whitelist style/he thong; doi text, anh A/B, crop, voiceover hoac timing khong lam nut sang. Khi cap nhat, Studio hien diff hop le, kiem tra lai asset, tang version va ghi changelog.

Neu project thieu pose/asset bat buoc, cap nhat bi chan va mau goc khong bi ghi rong.

Khi mau co version moi, badge `Mau co ban moi` va nut `Ap dung mau moi` xuat hien. Thao tac nay chi keo style/he thong ve project; content, anh A/B, crop/zoom/rotation, voiceover, SRT va timing duoc giu nguyen.

Template cu co the migrate bang:

```bash
node scripts/migrate-template-scope.mjs
```

Dung `--dry-run` de chi xem report ma chua ghi file.
