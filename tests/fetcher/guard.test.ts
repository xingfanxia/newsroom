import { describe, expect, it } from "bun:test";
import { guardUrl, isBlockedIp, GuardError } from "@/workers/fetcher/guard";

describe("isBlockedIp — IPv4", () => {
  it("blocks loopback", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("127.55.1.2")).toBe(true);
  });
  it("blocks AWS IMDS (169.254.*)", () => {
    expect(isBlockedIp("169.254.169.254")).toBe(true);
  });
  it("blocks RFC1918 ranges", () => {
    expect(isBlockedIp("10.0.0.1")).toBe(true);
    expect(isBlockedIp("172.16.0.1")).toBe(true);
    expect(isBlockedIp("172.31.255.254")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
  });
  it("blocks CG-NAT (100.64-127.*)", () => {
    expect(isBlockedIp("100.64.0.1")).toBe(true);
    expect(isBlockedIp("100.127.0.1")).toBe(true);
  });
  it("blocks multicast / reserved (>=224.*)", () => {
    expect(isBlockedIp("224.0.0.1")).toBe(true);
    expect(isBlockedIp("240.0.0.1")).toBe(true);
  });
  it("does NOT block public IPs", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("1.1.1.1")).toBe(false);
    expect(isBlockedIp("172.15.0.1")).toBe(false); // just outside 172.16/12
    expect(isBlockedIp("172.32.0.1")).toBe(false);
    expect(isBlockedIp("169.253.0.1")).toBe(false); // just outside 169.254
  });
});

describe("isBlockedIp — IPv6", () => {
  it("blocks loopback ::1 and unspecified ::", () => {
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("::")).toBe(true);
  });
  it("blocks ULA fc00::/7", () => {
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fd12:3456::1")).toBe(true);
  });
  it("blocks link-local fe80::/10", () => {
    expect(isBlockedIp("fe80::1")).toBe(true);
    expect(isBlockedIp("feb0::1")).toBe(true);
  });
  it("blocks ipv4-mapped loopback (::ffff:127.0.0.1)", () => {
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
  });
  it("does NOT block public ipv6", () => {
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
  });
});

describe("guardUrl — scheme / format", () => {
  it("rejects invalid URL", async () => {
    await expect(guardUrl("not a url")).rejects.toThrow(GuardError);
  });
  it("rejects file://", async () => {
    await expect(guardUrl("file:///etc/passwd")).rejects.toThrow(
      /invalid_scheme/,
    );
  });
  it("rejects gopher://", async () => {
    await expect(guardUrl("gopher://example.com")).rejects.toThrow(
      /invalid_scheme/,
    );
  });
  it("rejects literal loopback", async () => {
    await expect(guardUrl("http://127.0.0.1/")).rejects.toThrow(
      /blocked_ip_literal/,
    );
  });
  it("rejects literal IMDS", async () => {
    await expect(guardUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      /blocked_ip_literal/,
    );
  });
});
