# Ke Hoach Chuan Hoa Mau Goc Va Du An Rieng

## 1. Muc Tieu

Muc tieu la tao mot he thong mau goc chuan, trong do:

- Mau goc chi luu cac thanh phan style/he thong it thay doi.
- Moi du an tao tu mau co ban copy rieng, khong dung chung file voi mau goc hoac du an khac.
- Nut `Cap nhat mau` chi sang khi co thay doi hop le thuoc whitelist.
- Du an cu khong tu bi doi khi mau goc update version moi.
- Khi ap dung mau moi vao du an cu, app chi cap nhat style/he thong, khong de noi dung, anh, voice, timing rieng cua du an bi mat.

Danh gia muc tieu sau khi lam xong: 10/10 neu dat du cac tieu chi isolation, whitelist, versioning, diff UI, migration va test day du.

## 2. Nguyen Tac He Thong

He thong se tach thanh 2 lop:

```text
studio-templates/full/<template-id>/
  template.json
  assets/

videos/<project-slug>/
  video.json
  assets/
```

Mau goc la nguon style chuan. Du an la ban lam viec rieng.

Khong du an nao duoc tro truc tiep vao file trong `studio-templates`. Khi tao du an tu mau, toan bo asset can dung cua mau phai duoc copy sang thu muc cua du an.

Duong dan asset trong project nen theo dang:

```text
videos/<slug>/assets/template/<template-id>/v<version>/...
```

Vi du:

```text
videos/can-thi/assets/template/khi-vui-ve/v10/character/point-left.webm
videos/can-thi/assets/template/khi-vui-ve/v10/audio/bgm.mp3
videos/can-thi/assets/template/khi-vui-ve/v10/logo/logo.png
```

Neu xoa/sua trong mot project, chi xoa/sua trong `videos/<slug>`. Mau goc va project khac khong bi anh huong.

## 3. Mau Goc Duoc Luu Nhung Gi

Mau goc `full` chi luu cac phan thuoc style/he thong theo cac tab.

### Tab 1. Noi Dung

Duoc luu:

- Bo cuc video.
- Mau VS.
- Mau chu VS.
- Mau vien VS.
- Mau khung anh.
- Bong khung anh.
- Mau chu A/B.
- Co anh A/B chung.
- Vi tri anh A/B chung.
- Co anh so sanh 2 ben.
- Vi tri anh so sanh 2 ben.
- `poseStartSide`, tuc bat dau chi ben trai/phai.

Khong luu:

- Text content trong So sanh 1/2.
- Nhan noi dung cu the cua tung video, vi du "Chuot rut / Cang co".
- Anh A/B cua tung project.
- Crop/zoom/rotation rieng cua tung anh A/B.
- AI image variants/history rieng cua tung project.
- Focus theo tung dong content neu no phu thuoc vao noi dung tung project.

### Tab 2. Nhan Vat

Duoc luu:

- File pose nhan vat: `point-left`, `point-right`, `question`.
- `packId`.
- Scale nhan vat.
- Vi tri x/y nhan vat.
- Vi tri nhan vat trong layout.
- Chieu cao nhan vat.
- Font lien quan nhan vat/phu de neu dang duoc dung nhu mot phan cua style.
- Trang thai/canh bao asset nhan vat neu can de hien thi dung trong UI.

Khong luu:

- Trang thai mat file cua rieng mot project neu project do xoa nham.
- File temp dang convert.
- Job/progress runtime.

### Tab 3. Am Thanh

Da khoa quy tac: mau goc luu ca voice setting, nhung khong luu file voiceover sinh tu content.

Duoc luu:

- `provider`.
- `voiceId`.
- `speed`.
- `pitch`.
- `voiceVolume`.
- BGM mau neu duoc chon lam mot phan style.
- File BGM mau.
- Scene start sound.
- Pose SFX cho `point-left`, `point-right`, `question`.
- Volume chung.
- Volume tung pose.
- Toan bo file sound/SFX lien quan den mau.

Khong luu:

- File voiceover da tao tu noi dung project.
- Audio tung dong.
- `mainAudio`.
- `srt`.
- Duration.
- Word timing.
- Alignment/timing sinh tu audio rieng cua project.

### Tab 4. Phu De

Duoc luu:

- Style phu de.
- Animation.
- Font.
- Co chu.
- Mau chu thuong.
- Mau nhan.
- Mau vien.
- Do day vien.
- Uppercase.
- Shadow preset.
- Vi tri phu de.

Khong luu:

- Word timing.
- Timing tung cau/tung dong theo audio.
- Subtitle da can theo file voiceover cua project.

### Tab 5. Render

Duoc luu:

- Width.
- Height.
- FPS.
- Render mode/preferred mode.
- Cac setting render chung neu co.

Khong luu:

- File render output.
- Preview output.
- Snapshot.
- Render job.
- Pipeline runtime.

## 4. Mau Goc Tuyet Doi Khong Duoc Luu

Blacklist bat buoc:

- `lines` cua full template.
- `contentDraft`.
- `contentOfficial`.
- Text So sanh 1/2.
- Anh A/B cua project.
- Crop/zoom/rotation rieng cua tung anh.
- AI image variants/history rieng.
- `mainAudio`.
- `srt`.
- Audio tung dong.
- Duration.
- Word timing.
- Preview.
- Render output.
- Snapshot.
- Job/temp/cache runtime.
- Pipeline dirty/runtime state.

`Mau noi dung` neu van giu thi la tinh nang thu cong rieng, khong thuoc mau goc, khong lien ket version, khong tham gia `Cap nhat mau`.

## 5. Luong Tao Du An Tu Mau

Khi tao du an moi tu mau:

1. Doc `studio-templates/full/<template-id>/template.json`.
2. Tao thu muc `videos/<slug>`.
3. Copy asset mau sang:

```text
videos/<slug>/assets/template/<template-id>/v<version>/...
```

4. Ghi `video.json` cua project voi path tro vao thu muc project.
5. Luu `savedTemplateRef`:

```json
{
  "type": "full",
  "id": "khi-vui-ve",
  "name": "khi vui ve",
  "version": 10,
  "linkedAt": "ISO_DATE"
}
```

6. Content, anh A/B, voiceover cua project lay tu form/project, khong lay tu mau goc.

Ket qua dung:

- Project moi co style/nhan vat/sound/phu de/render giong mau.
- Project moi co content rieng.
- Project moi khong dung chung file voi mau goc.

## 6. Luong Cap Nhat Mau

Nut `Cap nhat mau` chi danh cho project dang lien ket voi mau goc.

Quy tac:

- Neu khong co diff thuoc whitelist: nut tat, khong bam duoc.
- Neu chi thay doi content/anh A-B/crop rieng/voiceover/timing: nut van tat.
- Neu thay doi caption/nhan vat/sound/layout/render: nut sang.
- Bam update thi hien danh sach thay doi hop le.
- Backend phai tinh lai diff lan nua truoc khi ghi, khong tin moi UI.

Khi update thanh cong:

1. Copy asset moi tu project ve `studio-templates/full/<template-id>/assets/...`.
2. Ghi lai `template.json` bang scope da pick theo whitelist.
3. Tang `version`.
4. Ghi `changelog`.
5. Cap nhat `savedTemplateRef.version` cho project nguon.

Neu project dang thieu asset bat buoc, vi du mat `point-left`, thi:

- Khong ghi rong len mau goc.
- Bao loi ro rang: project dang thieu asset nao.
- Yeu cau nguoi dung them lai asset truoc khi update mau.

## 7. Luong Du An Cu Khi Mau Co Ban Moi

Du an cu khong tu bi doi.

Neu template goc co version moi hon `savedTemplateRef.version`, UI hien:

```text
Mau co ban moi
Ap dung mau moi
```

Khi bam `Ap dung mau moi`:

- Chi keo ve cac phan style/he thong thuoc whitelist.
- Giu nguyen content.
- Giu nguyen anh A/B.
- Giu nguyen crop/zoom/rotation rieng cua anh.
- Giu nguyen voiceover da tao.
- Giu nguyen SRT/timing/duration/word timing.

Ket qua dung:

- Du an cu khong mat noi dung.
- Du an cu co the cap nhat giao dien/style theo mau moi khi nguoi dung muon.

## 8. API Can Them/Sua

### GET `/api/videos/:slug/template-status`

Tra ve:

```json
{
  "linkedTemplateRef": {},
  "latestVersion": 10,
  "isBehind": true,
  "canUpdateTemplate": true,
  "updateDiffs": [],
  "blockedReasons": []
}
```

Dung de:

- Bat/tat nut `Cap nhat mau`.
- Hien badge mau co ban moi.
- Hien danh sach diff.
- Hien ly do bi chan update.

### POST `/api/templates/:type/:id/update-from-video/:slug`

Backend phai:

- Validate project dang lien ket dung mau.
- Recompute whitelist diff.
- Neu khong co diff hop le thi khong bump version.
- Neu co asset bat buoc bi thieu thi reject.
- Copy asset vao template.
- Ghi template moi.
- Tang version.
- Ghi changelog.

### POST `/api/videos/:slug/apply-template-update`

Dung cho du an cu ap dung latest template.

Backend phai:

- Doc latest template.
- Apply chi whitelist.
- Giu nguyen content/anh A-B/voiceover/timing.
- Cap nhat `savedTemplateRef.version`.
- Mark dirty nhung pipeline can render lai.

## 9. Schema Template Chuan

Template `full` nen co dang:

```json
{
  "version": 10,
  "scopeVersion": 2,
  "id": "khi-vui-ve",
  "type": "full",
  "name": "khi vui ve",
  "description": "",
  "createdAt": "ISO_DATE",
  "updatedAt": "ISO_DATE",
  "sourceSlug": "can-thi",
  "parts": {
    "caption": true,
    "character": true,
    "audio": true,
    "layout": true,
    "background": true,
    "render": true,
    "content": false
  },
  "config": {},
  "assets": {},
  "changelog": [
    {
      "version": 10,
      "updatedAt": "ISO_DATE",
      "sourceSlug": "can-thi",
      "diffs": []
    }
  ]
}
```

`content` trong full template mac dinh la `false`.

## 10. File Can Them

### `shared/templateScope.mjs`

Chua logic dung chung frontend/backend:

- `TEMPLATE_SCOPE_VERSION = 2`.
- `pickTemplateScope(config)`.
- `diffTemplateScope(projectConfig, templateConfig)`.
- `TEMPLATE_DIFF_LABELS`.
- Whitelist/blacklist field.
- Normalizer de so sanh stable JSON.

Muc tieu: tat ca save/update/diff deu dung chung mot nguon su that, tranh frontend bao mot kieu backend ghi mot kieu.

### `studio/backend/services/templateAssets.mjs`

Chua logic asset:

- Resolve asset tu project/shared-assets.
- Copy asset project -> template.
- Copy asset template -> project.
- Validate asset bat buoc.
- Dam bao target path nam trong folder cho phep.
- Tao path chuan `assets/template/<template-id>/v<version>/...`.

### `scripts/migrate-template-scope.mjs`

Dung de migrate template cu:

- Them `scopeVersion: 2`.
- Strip field cam khoi full template.
- Giu lai asset style hop le.
- Bao report template nao bi strip field nao.

## 11. File Can Sua

### `studio/backend/services/templateLibrary.mjs`

Sua cac ham:

- `saveTemplateFromVideo`.
- `updateTemplateFromVideo`.
- `applyTemplateConfigParts`.
- `applyTemplateToVideo`.
- `listTemplates`/`getTemplate` neu can tra them scope/version/changelog.

Yeu cau:

- Khong extract config bang cach boc tung phan tu `video.json` cam tinh.
- Bat buoc di qua `pickTemplateScope`.
- Bat buoc copy asset bang `templateAssets`.
- Khong ghi content vao full template.
- Khong bump version neu diff rong.

### `studio/backend/services/videoCreator.mjs`

Sua luong tao project:

- Tao project tu template thi copy asset vao folder project.
- Path trong `video.json` tro vao folder project.
- Khong mac dinh dung shared/template asset neu project da lien ket template.

### `studio/backend/server.mjs`

Them route:

- `GET /api/videos/:slug/template-status`.
- `POST /api/videos/:slug/apply-template-update`.

Sua route update template neu can de tra ve `diffs`, `blockedReasons`, `version`.

### `studio/frontend/src/main.jsx`

Sua UI:

- Nut `Cap nhat mau` disabled theo `template-status`.
- Khi co diff hop le thi nut sang.
- Confirm update hien danh sach diff whitelist.
- Khong hien content/anh/voice/timing trong diff.
- Badge `Mau co ban moi`.
- Nut `Ap dung mau moi`.
- Khu vuc template actions can hien ro project dang lien ket version nao.

### Tests

Sua/them:

- `studio/backend/tests/templateLibrary.test.mjs`.
- `studio/backend/tests/projectTemplate.test.mjs`.
- Them test moi neu can: `studio/backend/tests/templateScope.test.mjs`.
- Them frontend smoke neu hien co: `scripts/studio-ui-smoke.mjs`.

### Docs

Sua:

- `studio/HUONG-DAN-SU-DUNG.md`.
- `README.md` neu can.

Noi dung docs can giai thich:

- Mau goc luu gi.
- Project rieng luu gi.
- Khi nao nut update sang.
- Du an cu ap dung mau moi nhu nao.

## 12. Test Backend Bat Buoc

### Test 1. Save full template strip content

Input project co:

- `lines`.
- `contentDraft`.
- `contentOfficial`.
- Anh A/B.
- Crop/zoom rieng.
- `mainAudio`.
- `srt`.
- Word timing.

Expected:

- Full template khong chua cac field cam.
- Full template van chua caption/character/audio setting/layout/background/render setting hop le.

### Test 2. Save full template copy asset style

Input project co:

- Character poses.
- Logo.
- Background.
- BGM.
- Pose SFX.

Expected:

- Template co file asset rieng trong `studio-templates/full/<id>/assets/...`.
- `template.json` tro vao asset template.

### Test 3. Create project from template isolates asset

Tao Project A tu template.

Expected:

- Asset duoc copy sang `videos/project-a/assets/template/...`.
- `video.json` cua Project A khong co path `studio-templates`.
- Xoa file trong Project A khong xoa file template.

### Test 4. Project A xoa pose khong anh huong Project B

Tao Project A va Project B tu cung template.

Xoa `point-left` trong Project A.

Expected:

- Project A mat pose.
- Project B van con pose.
- Template goc van con pose.

### Test 5. Update template bi chan neu pose bat buoc bi thieu

Project dang lien ket template bi mat `point-left`.

Expected:

- `update-from-video` reject.
- Template khong bi bump version.
- Template khong ghi pose rong.

### Test 6. Chi sua content thi khong update template

Project chi doi text content/anh A-B/crop rieng.

Expected:

- `template-status.canUpdateTemplate = false`.
- `updateDiffs = []`.
- Backend update khong bump version.

### Test 7. Sua style thi update template

Project doi:

- Font phu de.
- Scale nhan vat.
- Pose SFX.
- BGM.
- Mau VS.

Expected:

- `template-status.canUpdateTemplate = true`.
- Diff hien dung cac muc tren.
- Update bump version.
- Changelog co diff.

### Test 8. Apply template update vao project cu

Project cu co:

- Content rieng.
- Anh A/B rieng.
- Voiceover da tao.
- SRT/timing.

Template co version moi.

Expected:

- Sau khi apply, style moi duoc cap nhat.
- Content/anh A-B/voiceover/SRT/timing giu nguyen.

### Test 9. Migration template cu

Chay migration tren template cu co content va audio runtime.

Expected:

- Template duoc them `scopeVersion: 2`.
- Field cam bi strip.
- Asset style hop le van con.
- Report migration ro rang.

## 13. Test Frontend/Smoke

Can test cac scenario UI:

- Mo project lien ket template, khong thay doi gi: nut `Cap nhat mau` tat.
- Sua text content: nut van tat.
- Sua anh A/B: nut van tat.
- Sua crop anh: nut van tat.
- Sua font phu de: nut sang.
- Sua pose nhan vat: nut sang.
- Sua SFX/BGM: nut sang.
- Bam update: modal chi hien diff hop le.
- Project co template version moi: hien badge `Mau co ban moi`.
- Bam `Ap dung mau moi`: content/anh/voice/timing khong mat.

Lenh kiem tra:

```bash
npm run test:studio
npm run build:studio
npm run qa:studio-ui
```

## 14. Tieu Chi Nghiem Thu

Dat 10/10 neu:

- Khong co project nao dung chung file asset voi template goc.
- Khong co project nao dung chung file asset voi project khac.
- Full template khong bao gio chua content/anh A-B/voiceover/timing runtime.
- Nut `Cap nhat mau` chi sang khi diff thuoc whitelist.
- Update template co changelog va version.
- Project cu khong tu doi khi template update.
- Ap dung mau moi khong lam mat content/anh/voice/timing.
- Template cu duoc migrate an toan.
- Test backend va frontend smoke pass.

## 15. Review/Rui Ro Can Kiem Tra Ky

Rui ro lon nhat:

- Lo tay update nguyen `video.json` vao template.
- Frontend diff mot kieu, backend update mot kieu.
- Copy asset path sai lam project tro ve `studio-templates`.
- Update template tu project dang thieu asset lam template bi rong.
- Apply mau moi vao project cu de mat voiceover/timing.

Cach chan:

- Tat ca save/update/diff phai dung `shared/templateScope.mjs`.
- Backend recompute diff va validate truoc khi ghi.
- Test path asset khong duoc chua `studio-templates`.
- Test blacklist field trong template.
- Test project cu sau apply mau moi.

## 16. Assumptions Da Khoa

- Tab Am thanh luu ca voice setting: `provider`, `voiceId`, `speed`, `pitch`, `voiceVolume`.
- Khong luu file voiceover/timing/SRT sinh tu content.
- Sound/SFX/BGM mau luu day du, khong bo qua cai nao.
- `Mau noi dung` tach khoi mau goc, chi la tinh nang thu cong rieng.
- Du an cu khong tu bi mutate khi mau goc update.
- Nguoi dung phai bam `Ap dung mau moi` neu muon project cu nhan style moi.

