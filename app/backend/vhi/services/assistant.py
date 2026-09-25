"""Multilingual owner assistant (feature 4): BM / EN / 中文, retrieval over the demo knowledge base, a live
tool for GEAR slots, and a local LLM when one is reachable."""
from __future__ import annotations

import re

from sqlalchemy import select

from ..db import session_scope
from ..tables import Branch, ChatMessage
from . import booking
from .llm import LLM, detect_lang

SYSTEM = ("You are the VehicleSense assistant for vehicle owners in Malaysia. Answer in the user's language "
          "({lang}). Use ONLY the facts in CONTEXT. Keep it under 90 words, friendly, practical. If CONTEXT has slot "
          "times, list them. Never invent fees or rules.")
GREET = {"ms": "Maaf, saya belum pasti. Boleh terangkan lagi? Contoh: jenis pemeriksaan, harga, slot esok, tint, EV.",
         "en": "Sorry, I'm not sure yet. Could you rephrase? For example: which inspection, fees, tomorrow's slots, tint, EVs.",
         "zh": "抱歉，我还不太确定。可以换个说法吗？例如：检验类型、费用、明天的时段、隔热膜、电动车。"}
SLOT_TXT = {"ms": "Slot GEAR esok ({date}) di {branch}: {slots}. Caj tambahan RM {fee:.0f}. Tekan 'Tempah' untuk teruskan.",
            "en": "Tomorrow's GEAR slots ({date}) at {branch}: {slots}. Surcharge RM {fee:.0f}. Tap 'Book' to continue.",
            "zh": "明天 ({date}) {branch} 的 GEAR 时段：{slots}。附加费 RM {fee:.0f}。点击“预约”继续。"}
NO_SLOT = {"ms": "Maaf, tiada slot GEAR esok di {branch}. Cuba cawangan lain atau slot biasa.",
           "en": "Sorry, no GEAR slots left tomorrow at {branch}. Try another branch or a normal slot.",
           "zh": "抱歉，{branch} 明天已无 GEAR 时段。请尝试其他分行或普通时段。"}


def _branch_in(text: str, default: str = "BR01") -> tuple[str, str]:
    with session_scope() as s:
        brs = s.execute(select(Branch)).scalars().all()
        low = text.lower()
        for b in brs:
            if b.name.lower() in low:
                return b.branch_id, b.name
        d = s.get(Branch, default)
        return default, d.name if d else default


def reply(llm: LLM, conversation: str, text: str, lang: str | None = None, branch_hint: str | None = None) -> dict:
    lang = lang or detect_lang(text)
    hits = llm.retriever.search(text, k=2)
    top, score = hits[0]
    context, tool = [], None
    if score > 0.25:
        context.append(top["a"][lang])
        if len(hits) > 1 and hits[1][1] > 0.6:
            context.append(hits[1][0]["a"][lang])
    if top.get("tool") == "gear_slots" and score > 0.25:
        bid, bname = _branch_in(text, branch_hint or "BR01")
        g = booking.gear_slots(bid)
        tool = {"name": "gear_slots", "branch_id": bid, "branch": bname, **g}
        context.append((SLOT_TXT if g["slots"] else NO_SLOT)[lang].format(date=g["date"], branch=bname,
                                                                          slots=", ".join(g["slots"]), fee=g["surcharge_rm"]))
    answer, source = None, "template"
    if context:
        llm_text = llm.chat(SYSTEM.format(lang={"ms": "Bahasa Melayu", "en": "English", "zh": "Simplified Chinese"}[lang]),
                            [{"role": "user", "content": f"CONTEXT:\n" + "\n".join(context) + f"\n\nQUESTION: {text}"}])
        if llm_text:
            answer, source = llm_text, llm.status()["backend"]
        else:
            answer = "\n\n".join(context[-2:]) if tool else context[0]
    else:
        answer = GREET[lang]
    answer = re.sub(r"\n{3,}", "\n\n", answer)
    with session_scope() as s:
        s.add(ChatMessage(conversation=conversation, role="user", text=text, lang=lang))
        s.add(ChatMessage(conversation=conversation, role="assistant", text=answer, lang=lang, source=source,
                          meta={"kb": top["id"] if score > 0.25 else None, "score": round(score, 3), "tool": tool}))
    return {"answer": answer, "lang": lang, "source": source, "kb_item": top["id"] if score > 0.25 else None,
            "retrieval_score": round(score, 3), "tool": tool, "types": top.get("types") if score > 0.25 else None}


def history(conversation: str) -> list[dict]:
    with session_scope() as s:
        rows = s.execute(select(ChatMessage).where(ChatMessage.conversation == conversation).order_by(ChatMessage.id)).scalars().all()
        return [{"role": m.role, "text": m.text, "lang": m.lang, "source": m.source, "meta": m.meta} for m in rows]
