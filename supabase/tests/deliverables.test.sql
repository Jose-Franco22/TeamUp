-- Issue #57 — milestone deliverables: the flag, submitting and versioning,
-- late marking, the thread, and who can see a team's work and files.
--
-- The read rules are the ones most easily "tested" by a case that never
-- touches the policy: an outsider seeing zero rows proves nothing if there
-- were zero rows to see. So every refusal below sits next to a positive
-- control — the same query, as someone who *is* allowed, returning the row —
-- and the file checks read storage.objects the way the Storage server does
-- for a download, as the caller, through the policy.
--
-- The adviser half — reading, downloading, commenting, Approved / Changes
-- requested, and the team's notification — is near the end, with advisers
-- accepted through #54's own respond_to_adviser_request().
begin;
select plan(179);

select set_config('tests.owner_a',  tests.sign_in_with_microsoft('owner57a@utrgv.edu', 'Ana Owner')::text, true);
select set_config('tests.member_a', tests.sign_in_with_microsoft('member57a@utrgv.edu', 'Abe Member')::text, true);
select set_config('tests.owner_b',  tests.sign_in_with_microsoft('owner57b@utrgv.edu', 'Bo Owner')::text, true);
select set_config('tests.member_b', tests.sign_in_with_microsoft('member57b@utrgv.edu', 'Bea Member')::text, true);
select set_config('tests.loner',    tests.sign_in_with_microsoft('loner57@utrgv.edu', 'Lou Loner')::text, true);
select set_config('tests.adviser',  tests.sign_in_with_microsoft('adviser57@utrgv.edu', 'Ada Adviser')::text, true);
select set_config('tests.adviser_b', tests.sign_in_with_microsoft('adviser57b@utrgv.edu', 'Pat Pending')::text, true);
select set_config('tests.admin',    tests.sign_in_with_microsoft('instructor57@utrgv.edu', 'Instructor')::text, true);
select set_config('tests.owner_c',  tests.sign_in_with_microsoft('owner57c@utrgv.edu', 'Cy Owner')::text, true);
select set_config('tests.member_c', tests.sign_in_with_microsoft('member57c@utrgv.edu', 'Cam Member')::text, true);

-- protect_admin_flag() (18_) refuses this from `authenticated`.
update public.users set is_admin = true where id = current_setting('tests.admin')::uuid;

-- Only CS faculty can be asked to advise (44_faculty_advisers.sql). The
-- instructor is faculty as well as an admin, so they can advise project C.
insert into public.faculty_directory (email)
values ('adviser57@utrgv.edu'), ('adviser57b@utrgv.edu'), ('instructor57@utrgv.edu');

select set_config('tests.project_a',
  tests.create_full_team(current_setting('tests.owner_a')::uuid, current_setting('tests.member_a')::uuid)::text, true);
select set_config('tests.project_b',
  tests.create_full_team(current_setting('tests.owner_b')::uuid, current_setting('tests.member_b')::uuid)::text, true);
select set_config('tests.project_c',
  tests.create_full_team(current_setting('tests.owner_c')::uuid, current_setting('tests.member_c')::uuid)::text, true);

-- Four milestones: two that will take a deliverable (one due ahead, one
-- already past), one that never does, and a spare for the admin cases.
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select set_config('tests.proposal', (public.save_milestone(null, 'Project proposal', now() + interval '7 days')).id::text, true);
select set_config('tests.report',   (public.save_milestone(null, 'Status report', now() - interval '1 day')).id::text, true);
select set_config('tests.demo',     (public.save_milestone(null, 'Demo day', now() + interval '30 days')).id::text, true);
select set_config('tests.spare',    (public.save_milestone(null, 'Spare milestone', now() + interval '14 days')).id::text, true);
select tests.clear_authentication();

-- Folder prefixes, <project>/<milestone>/, for the uploads below.
select set_config('tests.dir_a_proposal', current_setting('tests.project_a') || '/' || current_setting('tests.proposal') || '/', true);
select set_config('tests.dir_a_report',   current_setting('tests.project_a') || '/' || current_setting('tests.report') || '/', true);
select set_config('tests.dir_a_demo',     current_setting('tests.project_a') || '/' || current_setting('tests.demo') || '/', true);
select set_config('tests.dir_b_proposal', current_setting('tests.project_b') || '/' || current_setting('tests.proposal') || '/', true);
select set_config('tests.pdf_a', current_setting('tests.dir_a_proposal') || gen_random_uuid() || '.pdf', true);

-- =========================================================================
-- THE SCHEMA
-- =========================================================================

select has_table('public', 'deliverable_submissions', 'deliverable_submissions exists');
select has_table('public', 'deliverable_comments', 'deliverable_comments exists');
select has_column('public', 'milestones', 'requires_deliverable', 'milestones have a requires_deliverable flag');
select is((select requires_deliverable from public.milestones where id = current_setting('tests.demo')::uuid), false,
  'a new milestone does not take a deliverable until an admin says so');

-- The bucket's limits are the Storage server's to enforce, not Postgres's
-- (00_supabase_stub.sql). What can be checked here is that this migration
-- set them, so the server has the right ones to enforce.
select is((select public from storage.buckets where id = 'deliverables'), false,
  'the deliverables bucket is private');
select is((select file_size_limit from storage.buckets where id = 'deliverables'), 26214400::bigint,
  'the bucket caps a file at 25 MB');
select is((select allowed_mime_types from storage.buckets where id = 'deliverables'),
  array['application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  'the bucket accepts PDF, DOCX and PPTX and nothing else');

-- =========================================================================
-- THE ADMIN MARKS A MILESTONE
-- =========================================================================

select tests.authenticate_as(current_setting('tests.owner_a')::uuid);
select throws_ok(
  $$ select public.set_milestone_requires_deliverable(current_setting('tests.proposal')::uuid, true) $$,
  '42501', 'Admin access required',
  'a student cannot mark a milestone as needing a deliverable');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select lives_ok(
  $$ select public.set_milestone_requires_deliverable(current_setting('tests.proposal')::uuid, true) $$,
  'an admin marks the proposal as needing a deliverable');
select lives_ok(
  $$ select public.set_milestone_requires_deliverable(current_setting('tests.report')::uuid, true) $$,
  'and the status report');
select lives_ok(
  $$ select public.set_milestone_requires_deliverable(current_setting('tests.spare')::uuid, true) $$,
  'and the spare');
select throws_ok(
  $$ select public.set_milestone_requires_deliverable(gen_random_uuid(), true) $$,
  'P0001', 'Milestone not found',
  'a milestone that does not exist cannot be marked');

select tests.clear_authentication();
select is((select requires_deliverable from public.milestones where id = current_setting('tests.proposal')::uuid), true,
  'the proposal now takes a deliverable');

-- =========================================================================
-- UPLOADING: the insert policy on storage.objects
-- =========================================================================
-- Each refusal is a 42501 from RLS, raised by the insert itself — exactly
-- what the Storage server hits and turns into a 403.

select tests.authenticate_as(current_setting('tests.owner_a')::uuid);
select lives_ok(
  format($$ select tests.upload_to_storage('deliverables', %L, 1048576, 'application/pdf') $$,
         current_setting('tests.pdf_a')),
  'a member uploads a PDF to their own deliverable''s folder');

select throws_ok(
  format($$ select tests.upload_to_storage('deliverables', %L, 1024, 'application/x-msdownload') $$,
         current_setting('tests.dir_a_proposal') || gen_random_uuid() || '.exe'),
  '42501', null,
  'an .exe is refused at upload');
select throws_ok(
  format($$ select tests.upload_to_storage('deliverables', %L, 1024, 'text/plain') $$,
         current_setting('tests.dir_a_proposal') || gen_random_uuid() || '.txt'),
  '42501', null,
  'so is a .txt');
select throws_ok(
  format($$ select tests.upload_to_storage('deliverables', %L, 1024, 'application/pdf') $$,
         current_setting('tests.dir_b_proposal') || gen_random_uuid() || '.pdf'),
  '42501', null,
  'a member cannot upload into another team''s folder');
select throws_ok(
  format($$ select tests.upload_to_storage('deliverables', %L, 1024, 'application/pdf') $$,
         current_setting('tests.dir_a_demo') || gen_random_uuid() || '.pdf'),
  '42501', null,
  'or for a milestone that does not take a deliverable');
select throws_ok(
  $$ select tests.upload_to_storage('deliverables', 'proposal.pdf', 1024, 'application/pdf') $$,
  '42501', null,
  'or anywhere outside the <project>/<milestone>/ layout');

-- Overwriting is an upsert, which needs an update policy; there is none.
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner, metadata)
            values ('deliverables', %L, auth.uid(), '{"size": 5, "mimetype": "application/pdf"}')
            on conflict (bucket_id, name) do update set metadata = excluded.metadata $$,
         current_setting('tests.pdf_a')),
  '42501', null,
  'an uploaded file cannot be overwritten with an upsert');

with u as (
  update storage.objects set metadata = '{"size": 5, "mimetype": "application/pdf"}'
   where bucket_id = 'deliverables' and name = current_setting('tests.pdf_a')
  returning 1
)
select is(count(*)::int, 0, 'nor changed with an update') from u;

with d as (
  delete from storage.objects
   where bucket_id = 'deliverables' and name = current_setting('tests.pdf_a')
  returning 1
)
select is(count(*)::int, 0, 'nor deleted') from d;

select tests.authenticate_as(current_setting('tests.loner')::uuid);
select throws_ok(
  format($$ select tests.upload_to_storage('deliverables', %L, 1024, 'application/pdf') $$,
         current_setting('tests.dir_a_proposal') || gen_random_uuid() || '.pdf'),
  '42501', null,
  'a student on no team cannot upload into a team''s folder');

select tests.clear_authentication();
select is((select (metadata ->> 'size')::bigint from storage.objects
            where bucket_id = 'deliverables' and name = current_setting('tests.pdf_a')), 1048576::bigint,
  'the uploaded file is still exactly as uploaded');

-- =========================================================================
-- SUBMITTING, AND RESUBMITTING
-- =========================================================================

select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select lives_ok(
  $$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid,
                                      p_link_url => '  https://docs.example.edu/proposal-draft  ') $$,
  'a member who isn''t the owner submits a link');

select tests.authenticate_as(current_setting('tests.owner_a')::uuid);
select lives_ok(
  format($$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                             current_setting('tests.proposal')::uuid,
                                             p_file_path => %L, p_file_name => 'Proposal v2.pdf') $$,
         current_setting('tests.pdf_a')),
  'the owner resubmits with the uploaded PDF');

select tests.clear_authentication();
select is((select count(*)::int from public.deliverable_submissions
            where project_id = current_setting('tests.project_a')::uuid
              and milestone_id = current_setting('tests.proposal')::uuid), 2,
  'resubmitting added a version rather than replacing the first');
select results_eq(
  $$ select version, kind from public.deliverable_submissions
      where project_id = current_setting('tests.project_a')::uuid
        and milestone_id = current_setting('tests.proposal')::uuid
      order by version $$,
  $$ values (1, 'link'::text), (2, 'file'::text) $$,
  'versions 1 and 2, in the order they were submitted');
select is((select link_url from public.deliverable_submissions
            where project_id = current_setting('tests.project_a')::uuid
              and milestone_id = current_setting('tests.proposal')::uuid and version = 1),
  'https://docs.example.edu/proposal-draft',
  'version 1 still holds its link, trimmed');
select is((select submitted_by from public.deliverable_submissions
            where project_id = current_setting('tests.project_a')::uuid
              and milestone_id = current_setting('tests.proposal')::uuid and version = 1),
  current_setting('tests.member_a')::uuid,
  'and still names who submitted it');
select results_eq(
  $$ select file_path, file_name, file_size, file_type, link_url is null
       from public.deliverable_submissions
      where project_id = current_setting('tests.project_a')::uuid
        and milestone_id = current_setting('tests.proposal')::uuid and version = 2 $$,
  format($$ values (%L::text, 'Proposal v2.pdf'::text, 1048576::bigint, 'pdf'::text, true) $$,
         current_setting('tests.pdf_a')),
  'version 2 records the stored file, its name, size and type');
select is((select status from public.deliverable_submissions
            where project_id = current_setting('tests.project_a')::uuid
              and milestone_id = current_setting('tests.proposal')::uuid and version = 2), 'submitted',
  'a new version is Submitted');

-- Versions count per team: team B's first is 1, not 3.
select tests.authenticate_as(current_setting('tests.member_b')::uuid);
select lives_ok(
  $$ select public.submit_deliverable(current_setting('tests.project_b')::uuid,
                                      current_setting('tests.proposal')::uuid,
                                      p_link_url => 'https://b.example.edu/proposal') $$,
  'the other team submits for the same milestone');
select tests.clear_authentication();
select is((select version from public.deliverable_submissions
            where project_id = current_setting('tests.project_b')::uuid
              and milestone_id = current_setting('tests.proposal')::uuid), 1,
  'and gets its own version 1');

-- =========================================================================
-- WHO MAY SUBMIT
-- =========================================================================

select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select throws_ok(
  $$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid,
                                      p_link_url => 'https://evil.example.com/x') $$,
  'P0001', 'Only members of this team can submit its deliverables',
  'another team''s owner cannot submit for this team');

select tests.authenticate_as(current_setting('tests.loner')::uuid);
select throws_ok(
  $$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid,
                                      p_link_url => 'https://evil.example.com/x') $$,
  'P0001', 'Only members of this team can submit its deliverables',
  'a student on no team cannot submit for it');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select throws_ok(
  $$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid,
                                      p_link_url => 'https://admin.example.com/x') $$,
  'P0001', 'Only members of this team can submit its deliverables',
  'nor can an admin — they see a team''s work, they don''t hand it in');

select tests.clear_authentication();
select is((select count(*)::int from public.deliverable_submissions
            where project_id = current_setting('tests.project_a')::uuid), 2,
  'none of those refusals wrote anything');

select tests.authenticate_as(current_setting('tests.owner_a')::uuid);
select throws_ok(
  $$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.demo')::uuid,
                                      p_link_url => 'https://docs.example.edu/demo') $$,
  'P0001', 'This milestone doesn''t take a deliverable',
  'a milestone that takes no deliverable refuses a submission');
select throws_ok(
  $$ select public.submit_deliverable(current_setting('tests.project_a')::uuid, gen_random_uuid(),
                                      p_link_url => 'https://docs.example.edu/x') $$,
  'P0001', 'Milestone not found',
  'an unknown milestone is refused');
select throws_ok(
  $$ select public.submit_deliverable(gen_random_uuid(), current_setting('tests.proposal')::uuid,
                                      p_link_url => 'https://docs.example.edu/x') $$,
  'P0001', 'Project not found',
  'an unknown project is refused');

-- =========================================================================
-- WHAT MAY BE SUBMITTED
-- =========================================================================

select throws_ok(
  $$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid) $$,
  'P0001', 'Choose a file or paste a link',
  'nothing at all is refused');
select throws_ok(
  format($$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                             current_setting('tests.proposal')::uuid,
                                             %L, 'x.pdf', 'https://docs.example.edu/x') $$,
         current_setting('tests.pdf_a')),
  'P0001', 'Submit a file or a link, not both',
  'a file and a link together are refused');
select throws_ok(
  $$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid,
                                      p_link_url => 'javascript:alert(1)') $$,
  'P0001', 'Paste a full link that starts with http:// or https://',
  'a javascript: link is refused');
select throws_ok(
  $$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid,
                                      p_link_url => 'see the shared drive') $$,
  'P0001', 'Paste a full link that starts with http:// or https://',
  'so is a sentence');
select throws_ok(
  $$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid,
                                      p_link_url => 'https://docs.example.edu/' || repeat('a', 2000)) $$,
  'P0001', 'Keep the link to 2000 characters or fewer',
  'a link over 2000 characters is refused');
select throws_ok(
  format($$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                             current_setting('tests.proposal')::uuid,
                                             p_file_path => %L, p_file_name => 'again.pdf') $$,
         current_setting('tests.pdf_a')),
  'P0001', 'That file has already been submitted',
  'the same stored file cannot be a second version');
select throws_ok(
  format($$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                             current_setting('tests.proposal')::uuid,
                                             p_file_path => %L, p_file_name => 'ghost.pdf') $$,
         current_setting('tests.dir_a_proposal') || gen_random_uuid() || '.pdf'),
  'P0001', 'That file hasn''t been uploaded',
  'a path with no file behind it is refused');

-- Files that got into the bucket some other way — written here as the
-- superuser, standing in for a loosened bucket or a dashboard upload — so
-- these cases are about submit_deliverable()'s own checks and not the
-- upload policy's. Each would otherwise be accepted.
select tests.clear_authentication();
select set_config('tests.big_pdf',   current_setting('tests.dir_a_proposal') || gen_random_uuid() || '.pdf', true);
select set_config('tests.txt_file',  current_setting('tests.dir_a_proposal') || gen_random_uuid() || '.txt', true);
select set_config('tests.fake_pdf',  current_setting('tests.dir_a_proposal') || gen_random_uuid() || '.pdf', true);
select set_config('tests.b_pdf',     current_setting('tests.dir_b_proposal') || gen_random_uuid() || '.pdf', true);
select set_config('tests.empty_pdf', current_setting('tests.dir_a_proposal') || gen_random_uuid() || '.pdf', true);
insert into storage.objects (bucket_id, name, metadata) values
  ('deliverables', current_setting('tests.big_pdf'),   '{"size": 26214401, "mimetype": "application/pdf"}'),
  ('deliverables', current_setting('tests.txt_file'),  '{"size": 1024, "mimetype": "text/plain"}'),
  ('deliverables', current_setting('tests.fake_pdf'),  '{"size": 1024, "mimetype": "application/x-msdownload"}'),
  ('deliverables', current_setting('tests.b_pdf'),     '{"size": 1024, "mimetype": "application/pdf"}'),
  ('deliverables', current_setting('tests.empty_pdf'), null);

select tests.authenticate_as(current_setting('tests.owner_a')::uuid);
select throws_ok(
  format($$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                             current_setting('tests.proposal')::uuid,
                                             p_file_path => %L, p_file_name => 'huge.pdf') $$,
         current_setting('tests.big_pdf')),
  'P0001', 'Files can be at most 25 MB',
  'a file one byte over 25 MB is refused');
select throws_ok(
  format($$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                             current_setting('tests.proposal')::uuid,
                                             p_file_path => %L, p_file_name => 'notes.txt') $$,
         current_setting('tests.txt_file')),
  'P0001', 'Upload a PDF, DOCX or PPTX file',
  'a .txt file is refused');
select throws_ok(
  format($$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                             current_setting('tests.proposal')::uuid,
                                             p_file_path => %L, p_file_name => 'setup.pdf') $$,
         current_setting('tests.fake_pdf')),
  'P0001', 'Upload a PDF, DOCX or PPTX file',
  'a .pdf name that Storage recorded as an executable is refused');
select throws_ok(
  format($$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                             current_setting('tests.proposal')::uuid,
                                             p_file_path => %L, p_file_name => 'theirs.pdf') $$,
         current_setting('tests.b_pdf')),
  'P0001', 'That file isn''t in this deliverable''s folder',
  'another team''s stored file cannot be submitted by naming it');
select throws_ok(
  format($$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                             current_setting('tests.report')::uuid,
                                             p_file_path => %L, p_file_name => 'Proposal v2.pdf') $$,
         current_setting('tests.pdf_a')),
  'P0001', 'That file isn''t in this deliverable''s folder',
  'nor can this team''s proposal file be submitted as its status report');
select throws_ok(
  format($$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                             current_setting('tests.proposal')::uuid,
                                             p_file_path => %L, p_file_name => 'empty.pdf') $$,
         current_setting('tests.empty_pdf')),
  'P0001', 'That file is empty or hasn''t finished uploading',
  'a file Storage recorded no size for is refused');

-- The other two types, and the limit itself, go through.
select set_config('tests.docx_a', current_setting('tests.dir_a_proposal') || gen_random_uuid() || '.docx', true);
select set_config('tests.pptx_a', current_setting('tests.dir_a_proposal') || gen_random_uuid() || '.pptx', true);
select lives_ok(
  format($$ select tests.upload_to_storage('deliverables', %L, 20480,
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document') $$,
         current_setting('tests.docx_a')),
  'a DOCX uploads');
select lives_ok(
  format($$ select tests.upload_to_storage('deliverables', %L, 26214400,
              'application/vnd.openxmlformats-officedocument.presentationml.presentation') $$,
         current_setting('tests.pptx_a')),
  'a PPTX of exactly 25 MB uploads');
select throws_ok(
  format($$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                             current_setting('tests.proposal')::uuid,
                                             p_file_path => %L, p_file_name => '   ') $$,
         current_setting('tests.docx_a')),
  'P0001', 'Give the file a name',
  'a file needs a name to show');
select throws_ok(
  format($$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                             current_setting('tests.proposal')::uuid,
                                             p_file_path => %L, p_file_name => E'Report\u202Excod.docx') $$,
         current_setting('tests.docx_a')),
  'P0001', 'The file name can''t contain hidden or control characters',
  'a name with a bidirectional override is refused');
-- chr(133) is NEL, a C1 control. The database always refused it; the
-- browser didn't, until #95's review (lib/deliverables.test.js has that
-- side). This pins the database's half of the same range.
select throws_ok(
  format($$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                             current_setting('tests.proposal')::uuid,
                                             p_file_path => %L, p_file_name => 'Report' || chr(133) || '.docx') $$,
         current_setting('tests.docx_a')),
  'P0001', 'The file name can''t contain hidden or control characters',
  'a name with a C1 control character is refused');
select lives_ok(
  format($$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                             current_setting('tests.proposal')::uuid,
                                             p_file_path => %L, p_file_name => 'Proposal v3.docx') $$,
         current_setting('tests.docx_a')),
  'a DOCX is accepted');
select lives_ok(
  format($$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                             current_setting('tests.proposal')::uuid,
                                             p_file_path => %L, p_file_name => 'Slides.pptx') $$,
         current_setting('tests.pptx_a')),
  'a PPTX of exactly 25 MB is accepted');

select tests.clear_authentication();
select is((select max(version) from public.deliverable_submissions
            where project_id = current_setting('tests.project_a')::uuid
              and milestone_id = current_setting('tests.proposal')::uuid), 4,
  'the proposal is on version 4, and every refusal above left no version behind');

-- =========================================================================
-- LATE
-- =========================================================================

select is((select bool_or(is_late) from public.deliverable_submissions
            where project_id = current_setting('tests.project_a')::uuid
              and milestone_id = current_setting('tests.proposal')::uuid), false,
  'nothing submitted before the due date is marked late');

select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select lives_ok(
  $$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.report')::uuid,
                                      p_link_url => 'https://docs.example.edu/status') $$,
  'submitting after the due date is allowed');
select tests.clear_authentication();
select is((select is_late from public.deliverable_submissions
            where project_id = current_setting('tests.project_a')::uuid
              and milestone_id = current_setting('tests.report')::uuid), true,
  'but it is marked late');

-- Decision 3: late is a fact about when it was handed in.
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select lives_ok(
  $$ select public.save_milestone(current_setting('tests.report')::uuid, 'Status report',
                                  now() + interval '7 days') $$,
  'the admin moves the status report a week later');
select tests.clear_authentication();
select is((select is_late from public.deliverable_submissions
            where project_id = current_setting('tests.project_a')::uuid
              and milestone_id = current_setting('tests.report')::uuid), true,
  'and the submission that was late stays late');
select is((select requires_deliverable from public.milestones where id = current_setting('tests.report')::uuid), true,
  'editing the milestone through save_milestone() leaves its deliverable flag alone');

-- =========================================================================
-- THE THREAD
-- =========================================================================

select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select lives_ok(
  $$ select public.post_deliverable_comment(current_setting('tests.project_a')::uuid,
                                            current_setting('tests.proposal')::uuid,
                                            E'  We moved the budget to section 4.\r\n  ') $$,
  'a member replies in the thread');
select throws_ok(
  $$ select public.post_deliverable_comment(current_setting('tests.project_a')::uuid,
                                            current_setting('tests.proposal')::uuid, E' \n ') $$,
  'P0001', 'Write a comment first',
  'an empty comment is refused');
select throws_ok(
  $$ select public.post_deliverable_comment(current_setting('tests.project_a')::uuid,
                                            current_setting('tests.proposal')::uuid, repeat('a', 2001)) $$,
  'P0001', 'Keep the comment to 2000 characters or fewer',
  'a comment over 2000 characters is refused');
select throws_ok(
  $$ select public.post_deliverable_comment(current_setting('tests.project_a')::uuid,
                                            current_setting('tests.proposal')::uuid,
                                            'Next line' || chr(133) || 'here') $$,
  'P0001', 'The comment can''t contain hidden or control characters',
  'a comment with a C1 control character is refused');
select throws_ok(
  $$ select public.post_deliverable_comment(current_setting('tests.project_a')::uuid,
                                            current_setting('tests.demo')::uuid, 'Hello') $$,
  'P0001', 'This milestone doesn''t take a deliverable',
  'there is no thread on a milestone that takes no deliverable');

select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select throws_ok(
  $$ select public.post_deliverable_comment(current_setting('tests.project_a')::uuid,
                                            current_setting('tests.proposal')::uuid, 'Nice work') $$,
  'P0001', 'Only this team and its adviser can comment on its deliverables',
  'another team cannot comment in this team''s thread');

select tests.clear_authentication();
select is((select string_agg(body, ' | ') from public.deliverable_comments
            where project_id = current_setting('tests.project_a')::uuid),
  'We moved the budget to section 4.',
  'the comment is stored trimmed');
select is((select array_agg(s.version) from public.deliverable_comments c
             join public.deliverable_submissions s on s.id = c.submission_id
            where c.project_id = current_setting('tests.project_a')::uuid), array[4],
  'and is tied to the version that was newest when it was posted');
select is((select count(*)::int from public.deliverable_comments), 1,
  'and the refused comments wrote nothing');

-- =========================================================================
-- WHO CAN SEE A TEAM'S SUBMISSIONS AND FILES
-- =========================================================================
-- Positive control first, as the team; then the same queries as everyone
-- who must be refused. pdf_a is project A's file throughout.

select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select is((select count(*)::int from public.deliverable_submissions
            where project_id = current_setting('tests.project_a')::uuid), 5,
  'a member reads all five of their team''s submissions');
select is((select count(*)::int from public.deliverable_comments
            where project_id = current_setting('tests.project_a')::uuid), 1,
  'and their thread');
select is((select count(*)::int from storage.objects
            where bucket_id = 'deliverables' and name = current_setting('tests.pdf_a')), 1,
  'and can download their team''s file');
select is((select count(*)::int from public.deliverable_submissions
            where project_id = current_setting('tests.project_b')::uuid), 0,
  'but not the other team''s submission, which exists');

select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select is((select count(*)::int from public.deliverable_submissions
            where project_id = current_setting('tests.project_b')::uuid), 1,
  'the other team reads its own submission');
select is((select count(*)::int from public.deliverable_submissions
            where project_id = current_setting('tests.project_a')::uuid), 0,
  'and none of this team''s');
select is((select count(*)::int from public.deliverable_comments
            where project_id = current_setting('tests.project_a')::uuid), 0,
  'nor its thread');
select is((select count(*)::int from storage.objects
            where bucket_id = 'deliverables' and name = current_setting('tests.pdf_a')), 0,
  'and cannot download its file');
select is((select count(*)::int from storage.objects
            where bucket_id = 'deliverables'
              and name like current_setting('tests.project_a') || '/%'), 0,
  'or list any of its files');
select throws_ok(
  $$ select public.project_deliverables(current_setting('tests.project_a')::uuid) $$,
  'P0001', 'Only this team, its adviser and admins can see its deliverables',
  'project_deliverables() refuses another team rather than walking past the policy');

select tests.authenticate_as(current_setting('tests.loner')::uuid);
select is((select count(*)::int from public.deliverable_submissions), 0,
  'a student on no team reads no submissions');
select is((select count(*)::int from storage.objects where bucket_id = 'deliverables'), 0,
  'and no files');
select throws_ok(
  $$ select public.project_deliverables(current_setting('tests.project_a')::uuid) $$,
  'P0001', 'Only this team, its adviser and admins can see its deliverables',
  'and project_deliverables() refuses them too');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select is((select count(*)::int from public.deliverable_submissions
            where project_id = current_setting('tests.project_a')::uuid), 5,
  'an admin reads the team''s submissions');
select is((select count(*)::int from public.deliverable_comments
            where project_id = current_setting('tests.project_a')::uuid), 1,
  'and its thread');
select is((select count(*)::int from storage.objects
            where bucket_id = 'deliverables' and name = current_setting('tests.pdf_a')), 1,
  'and can download its file');
select lives_ok(
  $$ select public.project_deliverables(current_setting('tests.project_a')::uuid) $$,
  'and project_deliverables() lets an admin in');

select tests.clear_authentication();
select set_config('role', 'anon', true);
select is((select count(*)::int from public.deliverable_submissions), 0,
  'a guest reads no submissions');
select is((select count(*)::int from public.deliverable_comments), 0,
  'no comments');
select is((select count(*)::int from storage.objects where bucket_id = 'deliverables'), 0,
  'and no files');
select throws_ok(
  $$ select public.project_deliverables(current_setting('tests.project_a')::uuid) $$,
  '42501', null,
  'a guest cannot call project_deliverables() at all');
select throws_ok(
  $$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid,
                                      p_link_url => 'https://x.example.com/y') $$,
  '42501', null,
  'nor submit_deliverable()');
select throws_ok(
  $$ select public.post_deliverable_comment(current_setting('tests.project_a')::uuid,
                                            current_setting('tests.proposal')::uuid, 'hi') $$,
  '42501', null,
  'nor post_deliverable_comment()');
select throws_ok(
  $$ select public.set_milestone_requires_deliverable(current_setting('tests.proposal')::uuid, false) $$,
  '42501', null,
  'nor set_milestone_requires_deliverable()');
select tests.clear_authentication();

-- =========================================================================
-- THE ONLY WAY TO WRITE IS THROUGH THE FUNCTIONS
-- =========================================================================

select tests.authenticate_as(current_setting('tests.owner_a')::uuid);
select throws_ok(
  $$ insert into public.deliverable_submissions (project_id, milestone_id, version, kind, link_url, is_late, submitted_by)
     values (current_setting('tests.project_a')::uuid, current_setting('tests.proposal')::uuid,
             99, 'link', 'https://x.example.com/y', false, auth.uid()) $$,
  '42501', null,
  'a member cannot insert a submission straight into the table');

with u as (
  update public.deliverable_submissions set status = 'approved', is_late = false
   where project_id = current_setting('tests.project_a')::uuid
  returning 1
)
select is(count(*)::int, 0, 'nor approve their own work, or clear a late mark, with an update') from u;

with d as (
  delete from public.deliverable_submissions
   where project_id = current_setting('tests.project_a')::uuid
  returning 1
)
select is(count(*)::int, 0, 'nor delete a version') from d;

select throws_ok(
  $$ insert into public.deliverable_comments (project_id, milestone_id, author_id, body, decision)
     values (current_setting('tests.project_a')::uuid, current_setting('tests.proposal')::uuid,
             auth.uid(), 'Looks good', 'approved') $$,
  '42501', null,
  'a member cannot insert a comment — or a decision — straight into the table');

with u as (
  update public.deliverable_comments set body = 'edited', decision = 'approved'
   where project_id = current_setting('tests.project_a')::uuid
  returning 1
)
select is(count(*)::int, 0, 'nor rewrite a comment') from u;

with d as (
  delete from public.deliverable_comments
   where project_id = current_setting('tests.project_a')::uuid
  returning 1
)
select is(count(*)::int, 0, 'nor delete one') from d;

select tests.clear_authentication();
select results_eq(
  $$ select count(*)::int, bool_or(status <> 'submitted'), bool_or(is_late)
       from public.deliverable_submissions
      where project_id = current_setting('tests.project_a')::uuid $$,
  $$ values (5, false, true) $$,
  'all five versions are still there, still Submitted, and the late one is still late');
select is((select string_agg(body, ' | ') from public.deliverable_comments
            where project_id = current_setting('tests.project_a')::uuid),
  'We moved the budget to section 4.',
  'and the comment is unchanged');

-- =========================================================================
-- WHAT project_deliverables() RETURNS
-- =========================================================================

select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select set_config('tests.view', public.project_deliverables(current_setting('tests.project_a')::uuid)::text, true);
select tests.clear_authentication();

select is((select array_agg(d ->> 'name' order by ord)
             from jsonb_array_elements(current_setting('tests.view')::jsonb) with ordinality as x(d, ord)),
  array['Project proposal', 'Status report', 'Spare milestone'],
  'one entry per milestone that takes a deliverable, in due order, and not Demo day');
select is((select d ->> 'status' from jsonb_array_elements(current_setting('tests.view')::jsonb) d
            where d ->> 'name' = 'Project proposal'), 'submitted',
  'the proposal reads Submitted');
select is((select d ->> 'status' from jsonb_array_elements(current_setting('tests.view')::jsonb) d
            where d ->> 'name' = 'Spare milestone'), 'not_submitted',
  'a milestone nobody has submitted for reads Not submitted');
select is((select (d ->> 'is_late')::boolean from jsonb_array_elements(current_setting('tests.view')::jsonb) d
            where d ->> 'name' = 'Status report'), true,
  'the status report is flagged late');
select is((select array_agg((v ->> 'version')::int order by ord)
             from jsonb_array_elements(current_setting('tests.view')::jsonb) d,
                  jsonb_array_elements(d -> 'versions') with ordinality as x(v, ord)
            where d ->> 'name' = 'Project proposal'),
  array[4, 3, 2, 1],
  'every version of the proposal is listed, newest first');
select is((select v ->> 'submitted_by_name'
             from jsonb_array_elements(current_setting('tests.view')::jsonb) d,
                  jsonb_array_elements(d -> 'versions') v
            where d ->> 'name' = 'Project proposal' and (v ->> 'version')::int = 1),
  'Abe Member',
  'each version names who submitted it');
select is((select string_agg(c ->> 'author_name', ' | ')
             from jsonb_array_elements(current_setting('tests.view')::jsonb) d,
                  jsonb_array_elements(d -> 'comments') c
            where d ->> 'name' = 'Project proposal'),
  'Abe Member',
  'and the thread names who wrote each comment');
select is((select count(*)::int
             from jsonb_array_elements(current_setting('tests.view')::jsonb) d,
                  jsonb_array_elements(d -> 'versions') v
            where v ->> 'link_url' = 'https://b.example.edu/proposal'), 0,
  'the other team''s submission is nowhere in it');

-- =========================================================================
-- NOTIFICATIONS, AND THE ADVISER
-- =========================================================================
-- Every adviser here is accepted the real way, through #54's
-- respond_to_adviser_request() (40_), not by setting the status by hand.
--
--   Ada        accepted adviser of project A
--   Pat        invited to advise project B; pending, then accepted
--   Instructor an admin who is also on the faculty list, accepted adviser of
--              project C — so they reach C's deliverables twice over, through
--              is_admin() and through advised_project_ids(), and reach A's
--              only as an admin. The two paths are not disjoint, and the
--              cases below are written so that matters.

select is((select count(*)::int from public.notifications where kind = 'deliverable_submitted'), 0,
  'with no accepted adviser anywhere, no submission notified anyone');

select tests.authenticate_as(current_setting('tests.owner_a')::uuid);
select set_config('tests.req_a', (public.invite_adviser(current_setting('tests.project_a')::uuid,
                                                        current_setting('tests.adviser')::uuid)).id::text, true);
select tests.authenticate_as(current_setting('tests.owner_b')::uuid);
select set_config('tests.req_b', (public.invite_adviser(current_setting('tests.project_b')::uuid,
                                                        current_setting('tests.adviser_b')::uuid)).id::text, true);
select tests.authenticate_as(current_setting('tests.owner_c')::uuid);
select set_config('tests.req_c', (public.invite_adviser(current_setting('tests.project_c')::uuid,
                                                        current_setting('tests.admin')::uuid)).id::text, true);

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select lives_ok(
  $$ select public.respond_to_adviser_request(current_setting('tests.req_a')::uuid, true) $$,
  'Ada accepts advising project A');

select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select lives_ok(
  $$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.spare')::uuid,
                                      p_link_url => 'https://docs.example.edu/spare') $$,
  'the team submits with an adviser in place');
select throws_ok(
  format($$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                             current_setting('tests.proposal')::uuid,
                                             p_file_path => %L, p_file_name => 'huge.pdf') $$,
         current_setting('tests.big_pdf')),
  'P0001', 'Files can be at most 25 MB',
  'and then tries a submission that is refused');

select tests.authenticate_as(current_setting('tests.member_b')::uuid);
select lives_ok(
  $$ select public.submit_deliverable(current_setting('tests.project_b')::uuid,
                                      current_setting('tests.spare')::uuid,
                                      p_link_url => 'https://b.example.edu/spare') $$,
  'the other team submits with only a pending adviser');

select tests.clear_authentication();
select results_eq(
  $$ select user_id, project_id, actor_id from public.notifications where kind = 'deliverable_submitted' $$,
  $$ values (current_setting('tests.adviser')::uuid, current_setting('tests.project_a')::uuid,
             current_setting('tests.member_a')::uuid) $$,
  'exactly one notification: the accepted adviser, about their project, naming who submitted — '
  'not for the refused submission, and not to a pending adviser');

-- --- what the adviser can read -------------------------------------------

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select is((select count(*)::int from public.deliverable_submissions
            where project_id = current_setting('tests.project_a')::uuid), 6,
  'the adviser reads every version project A has submitted');
select is((select count(*)::int from public.deliverable_comments
            where project_id = current_setting('tests.project_a')::uuid), 1,
  'and its thread');
select is((select count(*)::int from storage.objects
            where bucket_id = 'deliverables' and name = current_setting('tests.pdf_a')), 1,
  'and can download its file — the Storage select policy lets the adviser in too');
select lives_ok(
  $$ select public.project_deliverables(current_setting('tests.project_a')::uuid) $$,
  'and project_deliverables() lets the adviser in');

-- Pat is only invited to B so far. The positive control is B's own member.
select tests.authenticate_as(current_setting('tests.member_b')::uuid);
select is((select count(*)::int from public.deliverable_submissions
            where project_id = current_setting('tests.project_b')::uuid), 2,
  'project B has two submissions, which its member reads');
select tests.authenticate_as(current_setting('tests.adviser_b')::uuid);
select is((select count(*)::int from public.deliverable_submissions
            where project_id = current_setting('tests.project_b')::uuid), 0,
  'an adviser who has only been invited reads none of them');
select throws_ok(
  $$ select public.project_deliverables(current_setting('tests.project_b')::uuid) $$,
  'P0001', 'Only this team, its adviser and admins can see its deliverables',
  'and project_deliverables() refuses them');

select lives_ok(
  $$ select public.respond_to_adviser_request(current_setting('tests.req_b')::uuid, true) $$,
  'Pat accepts advising project B');
select is((select count(*)::int from public.deliverable_submissions
            where project_id = current_setting('tests.project_b')::uuid), 2,
  'and now reads B''s submissions');

-- The adviser of B against A's work, which Ada reads above.
select is((select count(*)::int from public.deliverable_submissions
            where project_id = current_setting('tests.project_a')::uuid), 0,
  'the adviser of another project reads none of A''s submissions');
select is((select count(*)::int from public.deliverable_comments
            where project_id = current_setting('tests.project_a')::uuid), 0,
  'nor its thread');
select is((select count(*)::int from storage.objects
            where bucket_id = 'deliverables' and name = current_setting('tests.pdf_a')), 0,
  'and cannot download A''s file');
select is((select count(*)::int from storage.objects
            where bucket_id = 'deliverables'
              and name like current_setting('tests.project_a') || '/%'), 0,
  'or list any of A''s files');
select throws_ok(
  $$ select public.project_deliverables(current_setting('tests.project_a')::uuid) $$,
  'P0001', 'Only this team, its adviser and admins can see its deliverables',
  'and project_deliverables() refuses them for A');

-- --- the adviser in the thread -------------------------------------------

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select lives_ok(
  $$ select public.post_deliverable_comment(current_setting('tests.project_a')::uuid,
                                            current_setting('tests.proposal')::uuid,
                                            'Section 4 still needs camera costs.') $$,
  'the adviser comments in the thread');

select tests.clear_authentication();
select results_eq(
  $$ select user_id, project_id, actor_id from public.notifications
      where kind = 'deliverable_feedback' order by user_id $$,
  format($$ select * from (values (%L::uuid, %L::uuid, %L::uuid), (%L::uuid, %L::uuid, %L::uuid)) v order by 1 $$,
         current_setting('tests.owner_a'), current_setting('tests.project_a'), current_setting('tests.adviser'),
         current_setting('tests.member_a'), current_setting('tests.project_a'), current_setting('tests.adviser')),
  'both members of the team are told the adviser responded, and nobody else is');

select tests.authenticate_as(current_setting('tests.adviser_b')::uuid);
select throws_ok(
  $$ select public.post_deliverable_comment(current_setting('tests.project_a')::uuid,
                                            current_setting('tests.proposal')::uuid, 'Looks fine') $$,
  'P0001', 'Only this team and its adviser can comment on its deliverables',
  'the adviser of another project cannot comment on A');

select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select lives_ok(
  $$ select public.post_deliverable_comment(current_setting('tests.project_a')::uuid,
                                            current_setting('tests.proposal')::uuid, 'Adding them now.') $$,
  'the team replies');
select tests.clear_authentication();
select is((select count(*)::int from public.notifications where kind = 'deliverable_feedback'), 2,
  'a team member''s reply notifies nobody');

-- --- who may decide -------------------------------------------------------
-- Project A's proposal is on version 4.

select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select throws_ok(
  $$ select public.review_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid, 4, 'approved') $$,
  'P0001', 'Only the project''s adviser can approve or request changes',
  'a team member cannot approve their own work');
select tests.authenticate_as(current_setting('tests.owner_a')::uuid);
select throws_ok(
  $$ select public.review_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid, 4, 'approved') $$,
  'P0001', 'Only the project''s adviser can approve or request changes',
  'nor can the owner');
select tests.authenticate_as(current_setting('tests.adviser_b')::uuid);
select throws_ok(
  $$ select public.review_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid, 4, 'approved') $$,
  'P0001', 'Only the project''s adviser can approve or request changes',
  'nor the adviser of another project');
select tests.authenticate_as(current_setting('tests.admin')::uuid);
select throws_ok(
  $$ select public.review_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid, 4, 'approved') $$,
  'P0001', 'Only the project''s adviser can approve or request changes',
  'nor an admin who is not A''s adviser — reading is not reviewing');

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select throws_ok(
  $$ select public.review_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid, 4, 'rejected') $$,
  'P0001', 'Choose Approved or Changes requested',
  'a decision other than the two is refused');
select throws_ok(
  $$ select public.review_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid, 4, 'changes_requested', '   ') $$,
  'P0001', 'Say what needs to change',
  'Changes requested has to say what to change');
select throws_ok(
  $$ select public.review_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid, 3, 'approved') $$,
  'P0001', 'A newer version has been submitted since — review that one',
  'a decision on version 3 is refused once version 4 exists');

select tests.clear_authentication();
select results_eq(
  $$ select bool_or(status <> 'submitted'),
            (select count(*)::int from public.notifications where kind = 'deliverable_feedback')
       from public.deliverable_submissions
      where project_id = current_setting('tests.project_a')::uuid $$,
  $$ values (false, 2) $$,
  'none of those refusals changed a status or notified anyone');

-- --- the adviser decides --------------------------------------------------

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select lives_ok(
  $$ select public.review_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid, 4, 'changes_requested',
                                      'Split the risks section by owner.') $$,
  'the adviser requests changes on version 4');

select tests.clear_authentication();
select results_eq(
  $$ select version, status from public.deliverable_submissions
      where project_id = current_setting('tests.project_a')::uuid
        and milestone_id = current_setting('tests.proposal')::uuid
      order by version $$,
  $$ values (1, 'submitted'::text), (2, 'submitted'::text), (3, 'submitted'::text), (4, 'changes_requested'::text) $$,
  'version 4 reads Changes requested; earlier versions keep theirs');
select results_eq(
  $$ select c.body, c.decision, s.version, c.author_id
       from public.deliverable_comments c
       join public.deliverable_submissions s on s.id = c.submission_id
      where c.project_id = current_setting('tests.project_a')::uuid and c.decision is not null $$,
  format($$ values ('Split the risks section by owner.'::text, 'changes_requested'::text, 4, %L::uuid) $$,
         current_setting('tests.adviser')),
  'the decision is in the thread, tied to version 4, with its note and its author');
select is((select count(*)::int from public.notifications where kind = 'deliverable_feedback'), 4,
  'and both members are told again');

select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select is((select d ->> 'status' from jsonb_array_elements(
             public.project_deliverables(current_setting('tests.project_a')::uuid)) d
            where d ->> 'name' = 'Project proposal'), 'changes_requested',
  'the team page reads Changes requested');

select lives_ok(
  $$ select public.submit_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid,
                                      p_link_url => 'https://docs.example.edu/proposal-v5') $$,
  'the team resubmits');
select is((select d ->> 'status' from jsonb_array_elements(
             public.project_deliverables(current_setting('tests.project_a')::uuid)) d
            where d ->> 'name' = 'Project proposal'), 'submitted',
  'and the deliverable reads Submitted again');

select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select lives_ok(
  $$ select public.review_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid, 5, 'approved') $$,
  'the adviser approves version 5 without a note');

select tests.clear_authentication();
select results_eq(
  $$ select s.status, c.body, c.decision
       from public.deliverable_submissions s
       join public.deliverable_comments c on c.submission_id = s.id and c.decision is not null
      where s.project_id = current_setting('tests.project_a')::uuid
        and s.milestone_id = current_setting('tests.proposal')::uuid and s.version = 5 $$,
  $$ values ('approved'::text, ''::text, 'approved'::text) $$,
  'version 5 is Approved, with an empty note');
select tests.authenticate_as(current_setting('tests.member_a')::uuid);
select is((select d ->> 'status' from jsonb_array_elements(
             public.project_deliverables(current_setting('tests.project_a')::uuid)) d
            where d ->> 'name' = 'Project proposal'), 'approved',
  'and the team page reads Approved');

-- The functions stay the only way in, for the adviser too.
select tests.authenticate_as(current_setting('tests.adviser')::uuid);
select throws_ok(
  $$ insert into public.deliverable_comments (project_id, milestone_id, author_id, body, decision)
     values (current_setting('tests.project_a')::uuid, current_setting('tests.proposal')::uuid,
             auth.uid(), 'ok', 'approved') $$,
  '42501', null,
  'the adviser cannot write a decision straight into the table');
with u as (
  update public.deliverable_submissions set status = 'changes_requested'
   where project_id = current_setting('tests.project_a')::uuid
  returning 1
)
select is(count(*)::int, 0, 'nor change a status with an update') from u;

-- Pat decides on B, which is theirs, and A is untouched by it.
select tests.authenticate_as(current_setting('tests.adviser_b')::uuid);
select lives_ok(
  $$ select public.review_deliverable(current_setting('tests.project_b')::uuid,
                                      current_setting('tests.proposal')::uuid, 1, 'approved', 'Good start.') $$,
  'the adviser of B approves B''s proposal');
select tests.clear_authentication();
select is((select count(*)::int from public.notifications
            where kind = 'deliverable_feedback' and project_id = current_setting('tests.project_b')::uuid), 2,
  'and B''s two members are told');

-- --- an admin who is also an adviser -------------------------------------

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select lives_ok(
  $$ select public.respond_to_adviser_request(current_setting('tests.req_c')::uuid, true) $$,
  'the instructor, an admin on the faculty list, accepts advising project C');
select throws_ok(
  $$ select public.review_deliverable(current_setting('tests.project_c')::uuid,
                                      current_setting('tests.proposal')::uuid, 1, 'approved') $$,
  'P0001', 'Nothing has been submitted to review yet',
  'there is nothing on C to review yet');

select tests.authenticate_as(current_setting('tests.member_c')::uuid);
select lives_ok(
  $$ select public.submit_deliverable(current_setting('tests.project_c')::uuid,
                                      current_setting('tests.proposal')::uuid,
                                      p_link_url => 'https://c.example.edu/proposal') $$,
  'project C submits its proposal');

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select lives_ok(
  $$ select public.review_deliverable(current_setting('tests.project_c')::uuid,
                                      current_setting('tests.proposal')::uuid, 1, 'changes_requested',
                                      'Add a timeline.') $$,
  'as C''s adviser, the instructor reviews C');
select throws_ok(
  $$ select public.review_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid, 5, 'changes_requested', 'x') $$,
  'P0001', 'Only the project''s adviser can approve or request changes',
  'and advising C still gives them no say over A');
select is((select count(*)::int from public.deliverable_submissions
            where project_id = current_setting('tests.project_a')::uuid), 7,
  'though as an admin they still read all seven of A''s versions');

select tests.clear_authentication();
select set_config('role', 'anon', true);
select throws_ok(
  $$ select public.review_deliverable(current_setting('tests.project_a')::uuid,
                                      current_setting('tests.proposal')::uuid, 5, 'approved') $$,
  '42501', null,
  'a guest cannot call review_deliverable() at all');
select tests.clear_authentication();

-- --- every kind of notification still fits -------------------------------
-- This file rewrites notifications_kind_check, so it is the one that has to
-- prove it dropped nothing: one row of every kind Testing already had, plus
-- the two this file adds, and a made-up kind that must still be refused.

select lives_ok(
  format($$ insert into public.notifications (user_id, kind)
            select %L::uuid, k from unnest(array[
              'adviser_accepted', 'adviser_declined', 'adviser_invited', 'adviser_removed',
              'adviser_stepped_down', 'check_in_reminder', 'deadline_reminder',
              'deliverable_feedback', 'deliverable_submitted', 'join_request', 'member_added',
              'member_assigned', 'member_left', 'member_removed', 'project_removed',
              'request_accepted', 'request_declined', 'team_complete']) k $$,
         current_setting('tests.loner')),
  'every existing notification kind is still accepted, and both new ones are');
select throws_ok(
  format($$ insert into public.notifications (user_id, kind) values (%L::uuid, 'deliverable_graded') $$,
         current_setting('tests.loner')),
  '23514', null,
  'a kind that is not on the list is still refused');

-- =========================================================================
-- A MILESTONE WITH WORK ON IT KEEPS IT
-- =========================================================================

select tests.authenticate_as(current_setting('tests.admin')::uuid);
select throws_ok(
  $$ select public.set_milestone_requires_deliverable(current_setting('tests.proposal')::uuid, false) $$,
  'P0001', 'Teams have already submitted for this milestone, so it has to keep taking deliverables',
  'a milestone with submissions cannot stop taking deliverables');
select throws_ok(
  $$ select public.delete_milestone(current_setting('tests.proposal')::uuid) $$,
  'P0001', 'Teams have already submitted for this milestone, so it can''t be deleted',
  'nor be deleted');
select lives_ok(
  $$ select public.set_milestone_requires_deliverable(current_setting('tests.demo')::uuid, true) $$,
  'a milestone nobody has submitted for can be marked');
select lives_ok(
  $$ select public.set_milestone_requires_deliverable(current_setting('tests.demo')::uuid, false) $$,
  'and unmarked again');
select lives_ok(
  $$ select public.delete_milestone(current_setting('tests.demo')::uuid) $$,
  'and deleted');

select tests.clear_authentication();
select is((select count(*)::int from public.deliverable_submissions
            where milestone_id = current_setting('tests.proposal')::uuid), 7,
  'the proposal''s submissions survived both refusals');

select * from finish();
rollback;
