-- =====================================================================================================================================
-- PRICING SLIDER — drop the slider's own log, slider_event (owner, 2026-10-20: "We dont need a log. Save the space on the DB").
-- =====================================================================================================================================
-- It repeated what is already recorded elsewhere: every price the slider moves is a price_change_log / amz_price_log row (the product's
-- price history), each action is a bclog line (section 'Slider'), and slider_member's state / ended_at / found_at say how a product
-- left. The one thing that read it — "has this slider ever changed a price?" (Delete vs End) — now reads slider_member.last_log_id.
--
-- RUN AFTER the server code that stops writing it is live: the old routes INSERT into slider_event and would fail without it.
-- =====================================================================================================================================

DROP TABLE IF EXISTS slider_event;
