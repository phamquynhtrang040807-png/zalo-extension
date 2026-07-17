// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { isCreatorDetailPage, parseCreatorPage } from "../src/parser";

const FIXTURE = `
  <main>
    <h1>Chi tiết về nhà sáng tạo</h1>
    <section>
      <div data-e2e="creator-username">quynhanh_lee</div>
      <div data-e2e="creator-display-name">Quỳnh Anh diệu</div>
      <div><span>Người theo dõi</span><strong>12,2K</strong></div>
    </section>
    <section><h2>Doanh số</h2><div><span>GMV</span><strong>718,5 Tr đ</strong></div></section>
    <p>15 tháng 6 2026 - 15 tháng 7 2026 (GMT+7)</p>
    <a href="tel:0912345678">0912 345 678</a>
  </main>`;

describe("TikTok Shop parser", () => {
  beforeEach(() => {
    document.body.innerHTML = FIXTURE;
    window.history.replaceState({}, "", "/affiliate/creator/abc123?creator_id=abc123");
  });

  it("recognizes and extracts a creator detail page", () => {
    expect(isCreatorDetailPage(document)).toBe(true);
    const result = parseCreatorPage(document);
    expect(result.username).toBe("quynhanh_lee");
    expect(result.display_name).toBe("Quỳnh Anh diệu");
    expect(result.followers_raw).toBe("12,2K");
    expect(result.gmv_raw).toBe("718,5 Tr đ");
    expect(result.phone_raw).toContain("0912");
    expect(result.profile_id).toBe("abc123");
  });

  it("does not show on unrelated pages", () => {
    document.body.innerHTML = "<h1>Trang chủ</h1>";
    expect(isCreatorDetailPage(document)).toBe(false);
  });

  it("takes the profile username instead of Trung from the page title", () => {
    document.body.innerHTML = `
      <header>TikTok Shop | Trung tâm liên kết</header>
      <main>
        <h1>Chi tiết về nhà sáng tạo</h1>
        <section>
          <img src="avatar.jpg" alt="avatar" />
          <div>
            <span>Điểm</span><strong>4.7</strong>
            <span class="text-headline-1 mr-8">hoalela1102</span>
            <button aria-label="Zalo"><svg></svg></button>
            <button aria-label="Email"><svg></svg></button>
            <div>Hoa Lê La</div>
            <div><span>Người theo dõi</span><strong>43,8K</strong></div>
          </div>
        </section>
        <section><span>GMV</span><strong>7,2 Tr đ</strong></section>
      </main>`;

    expect(parseCreatorPage(document).username).toBe("hoalela1102");
  });
});
