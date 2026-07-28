CREATE OR REPLACE FUNCTION public.assign_college_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE parts text[];
        word text;
        base text := '';
        candidate text;
        n int := 1;
BEGIN
  IF NEW.approved AND (TG_OP = 'INSERT' OR COALESCE(OLD.approved, false) = false) THEN
    parts := regexp_split_to_array(btrim(NEW.full_name), '\s+');
    FOREACH word IN ARRAY parts LOOP
      word := lower(regexp_replace(word, '[^a-zA-Z0-9]', '', 'g'));
      IF word <> '' AND word NOT IN ('dr','mr','mrs','ms','miss','prof','professor','shri','smt') THEN
        base := word;
        EXIT;
      END IF;
    END LOOP;
    IF base = '' THEN base := 'staff'; END IF;
    candidate := base || '@CSC.COM';
    WHILE EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = candidate AND p.id <> NEW.id) LOOP
      n := n + 1;
      candidate := base || n::text || '@CSC.COM';
    END LOOP;
    NEW.user_id := candidate;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_college_id() FROM anon, authenticated;