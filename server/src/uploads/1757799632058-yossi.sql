--
-- PostgreSQL database dump
--

-- Dumped from database version 17.5
-- Dumped by pg_dump version 17.5

-- Started on 2025-08-25 14:57:36

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 5 (class 2615 OID 16710)
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO postgres;

--
-- TOC entry 222 (class 1255 OID 16773)
-- Name: trigf1(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.trigf1() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
    post_time timestamp;
    comment_time timestamp;
begin
    select (p.pdate + p.ptime) into post_time
    from post p
    where p.pid = new.pid;
    comment_time := (new.cdate + new.ctime);
    if comment_time <= post_time then
        raise exception 'Error';
    end if;
    return new;
end;
$$;


ALTER FUNCTION public.trigf1() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 219 (class 1259 OID 16728)
-- Name: comment; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.comment (
    pid integer NOT NULL,
    cdate date NOT NULL,
    ctime time without time zone NOT NULL,
    uid integer,
    content character varying(255)
);


ALTER TABLE public.comment OWNER TO postgres;

--
-- TOC entry 221 (class 1259 OID 16758)
-- Name: follow; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.follow (
    fuid integer NOT NULL,
    uid integer NOT NULL
);


ALTER TABLE public.follow OWNER TO postgres;

--
-- TOC entry 220 (class 1259 OID 16743)
-- Name: likes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.likes (
    uid integer NOT NULL,
    pid integer NOT NULL,
    ldate date,
    ltime time without time zone
);


ALTER TABLE public.likes OWNER TO postgres;

--
-- TOC entry 218 (class 1259 OID 16716)
-- Name: post; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.post (
    pid integer NOT NULL,
    uid integer,
    content character varying(255),
    imageurl character varying(255),
    pdate date,
    ptime time without time zone
);


ALTER TABLE public.post OWNER TO postgres;

--
-- TOC entry 217 (class 1259 OID 16711)
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    uid integer NOT NULL,
    name character varying(30),
    email character varying(50),
    password character varying(50),
    descr character varying(255),
    country character varying(50)
);


ALTER TABLE public.users OWNER TO postgres;

--
-- TOC entry 4822 (class 0 OID 16728)
-- Dependencies: 219
-- Data for Name: comment; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.comment (pid, cdate, ctime, uid, content) FROM stdin;
101	2025-05-05	19:00:00	2	beautiful!
101	2025-05-05	19:05:00	3	love the colors.
102	2025-04-21	14:00:00	1	awesome hike!
102	2025-04-22	16:00:00	8	nice view.
103	2025-04-22	13:00:00	5	yummy!
104	2025-05-02	10:15:00	6	great beat!
106	2025-05-03	11:30:00	2	interesting insights.
107	2025-04-26	22:00:00	4	good luck!
108	2025-05-04	08:10:00	3	so pretty!
109	2025-05-06	12:10:00	5	delicious.
110	2025-02-19	18:00:00	1	helpful tutorial.
\.


--
-- TOC entry 4824 (class 0 OID 16758)
-- Dependencies: 221
-- Data for Name: follow; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.follow (fuid, uid) FROM stdin;
2	1
3	1
4	1
6	1
1	2
1	3
2	3
4	2
3	4
5	4
2	6
\.


--
-- TOC entry 4823 (class 0 OID 16743)
-- Dependencies: 220
-- Data for Name: likes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.likes (uid, pid, ldate, ltime) FROM stdin;
1	101	2025-05-05	21:00:00
1	102	2025-03-21	14:05:00
1	103	2025-04-22	14:10:00
1	104	2025-05-02	11:00:00
1	105	2025-03-15	09:05:00
1	111	2025-03-02	11:00:00
2	101	2025-05-05	18:50:00
2	103	2025-04-22	12:30:00
2	105	2025-03-15	09:00:00
2	111	2025-03-02	11:05:00
\.


--
-- TOC entry 4821 (class 0 OID 16716)
-- Dependencies: 218
-- Data for Name: post; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.post (pid, uid, content, imageurl, pdate, ptime) FROM stdin;
101	1	sunset in tel aviv	sun.jpg	2025-05-05	18:30:00
102	2	hiking the rockies	rockies.jpg	2025-04-20	10:00:00
103	3	best pasta recipe	pasta.jpg	2025-04-22	12:15:00
104	4	new song release	song.jpg	2025-05-01	15:45:00
105	1	morning coffee	coffee.jpg	2025-03-15	08:20:00
106	5	tech trends 2025	tech.jpg	2025-05-03	09:00:00
107	6	gaming marathon	game.jpg	2025-04-25	21:40:00
108	2	cherry blossoms	sakura.jpg	2025-05-04	07:50:00
109	3	street food adventures	street.jpg	2025-05-06	11:00:00
110	4	guitar tutorial	guitar.jpg	2025-02-18	17:10:00
111	3	city tour	oldcity.jpg	2025-03-01	10:00:00
\.


--
-- TOC entry 4820 (class 0 OID 16711)
-- Dependencies: 217
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (uid, name, email, password, descr, country) FROM stdin;
1	alice	alice@example.com	pass1	photographer	israel
2	bob	bob@example.com	pass2	traveler	usa
3	carol	carol@example.com	pass3	chef	italy
4	david	david@example.com	pass4	musician	israel
5	eve	eve@example.com	pass5	techie	canada
6	frank	frank@example.com	pass6	gamer	japan
7	grace	grace@example.com	pass7	reader	uk
8	hank	hank@example.com	pass8	blogger	france
\.


--
-- TOC entry 4662 (class 2606 OID 16732)
-- Name: comment comment_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.comment
    ADD CONSTRAINT comment_pkey PRIMARY KEY (pid, cdate, ctime);


--
-- TOC entry 4666 (class 2606 OID 16762)
-- Name: follow follow_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.follow
    ADD CONSTRAINT follow_pkey PRIMARY KEY (fuid, uid);


--
-- TOC entry 4664 (class 2606 OID 16747)
-- Name: likes likes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_pkey PRIMARY KEY (uid, pid);


--
-- TOC entry 4660 (class 2606 OID 16722)
-- Name: post post_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.post
    ADD CONSTRAINT post_pkey PRIMARY KEY (pid);


--
-- TOC entry 4658 (class 2606 OID 16715)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (uid);


--
-- TOC entry 4674 (class 2620 OID 16774)
-- Name: comment trigf1; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigf1 BEFORE INSERT ON public.comment FOR EACH ROW EXECUTE FUNCTION public.trigf1();


--
-- TOC entry 4668 (class 2606 OID 16733)
-- Name: comment comment_pid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.comment
    ADD CONSTRAINT comment_pid_fkey FOREIGN KEY (pid) REFERENCES public.post(pid);


--
-- TOC entry 4669 (class 2606 OID 16738)
-- Name: comment comment_uid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.comment
    ADD CONSTRAINT comment_uid_fkey FOREIGN KEY (uid) REFERENCES public.users(uid);


--
-- TOC entry 4672 (class 2606 OID 16763)
-- Name: follow follow_fuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.follow
    ADD CONSTRAINT follow_fuid_fkey FOREIGN KEY (fuid) REFERENCES public.users(uid);


--
-- TOC entry 4673 (class 2606 OID 16768)
-- Name: follow follow_uid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.follow
    ADD CONSTRAINT follow_uid_fkey FOREIGN KEY (uid) REFERENCES public.users(uid);


--
-- TOC entry 4670 (class 2606 OID 16753)
-- Name: likes likes_pid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_pid_fkey FOREIGN KEY (pid) REFERENCES public.post(pid);


--
-- TOC entry 4671 (class 2606 OID 16748)
-- Name: likes likes_uid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_uid_fkey FOREIGN KEY (uid) REFERENCES public.users(uid);


--
-- TOC entry 4667 (class 2606 OID 16723)
-- Name: post post_uid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.post
    ADD CONSTRAINT post_uid_fkey FOREIGN KEY (uid) REFERENCES public.users(uid);


--
-- TOC entry 4830 (class 0 OID 0)
-- Dependencies: 5
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: postgres
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;


-- Completed on 2025-08-25 14:57:36

--
-- PostgreSQL database dump complete
--

