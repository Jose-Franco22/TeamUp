// Pin the timezone for every test worker. Date tests (the roster file name
// uses the local date, not UTC) are only meaningful when local and UTC
// differ, and a CI runner is UTC. Runs once in the main process, before the
// workers start, so they inherit it.
export default function setup() {
  process.env.TZ = 'America/Chicago';
}
