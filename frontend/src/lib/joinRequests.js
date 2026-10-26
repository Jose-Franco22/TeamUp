// Why a student can't request to join a project (issue #32). Each
// sentence is word for word what create_join_request() raises
// (supabase/24_join_request_message.sql), so Browse can say it before the
// student even tries and the server says the same thing if they do.
export const JOIN_BLOCKED = {
  own: 'You cannot request to join your own project',
  onTeam: 'You are already on a team and cannot request to join another project',
  pending: 'You already have a pending request for this project',
  full: "This project is full and isn't taking requests",
  deadline: 'The team formation deadline has passed, so new join requests are closed',
};

export function isPastDeadline(deadline, now = new Date()) {
  return deadline != null && now >= new Date(deadline);
}
