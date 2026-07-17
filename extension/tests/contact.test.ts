// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { phoneFromZaloPopup, revealZaloPhone } from "../src/contact";

describe("Zalo contact popover", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("reads the number next to the Zalo label", () => {
    document.body.innerHTML = `
      <div class="popover">
        <div><span>Zalo:&nbsp;</span><div>0946475991</div></div>
        <div><span>Email:</span><div>creator@example.com</div></div>
      </div>`;

    expect(phoneFromZaloPopup(document)).toBe("0946475991");
  });

  it("adds a leading zero to a nine-digit Zalo number", () => {
    document.body.innerHTML = "<div><span>Zalo:</span><div>963263987</div></div>";

    expect(phoneFromZaloPopup(document)).toBe("0963263987");
  });

  it("keeps a non-standard Zalo value instead of rejecting it", () => {
    document.body.innerHTML = "<div><span>Zalo:</span><div>zalo-id_creator</div></div>";

    expect(phoneFromZaloPopup(document)).toBe("zalo-id_creator");
  });

  it("clicks the labelled Zalo icon and waits for the popup", async () => {
    document.body.innerHTML = `
      <div><strong>quynhanh_lee</strong><button aria-label="Zalo"><svg></svg></button></div>`;
    document.querySelector("button")!.addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div><span>Zalo:</span><div class="phone">0912 345 678</div></div>'
      );
    });

    await expect(revealZaloPhone(document, "quynhanh_lee", { candidateWaitMs: 50 })).resolves.toBe(
      "0912 345 678"
    );
  });

  it("falls back to an unlabelled icon beside the username", async () => {
    document.body.innerHTML = `
      <div><strong>quynhanh_lee</strong><span id="contact" style="cursor: pointer"><svg></svg></span></div>`;
    document.querySelector("#contact")!.addEventListener("click", () => {
      document.body.insertAdjacentHTML("beforeend", "<div><span>Zalo:</span><div>0987654321</div></div>");
    });

    await expect(revealZaloPhone(document, "quynhanh_lee", { candidateWaitMs: 50 })).resolves.toBe(
      "0987654321"
    );
  });
});
