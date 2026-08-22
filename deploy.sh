#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$ROOT_DIR"

log() {
  printf '[deploy] %s\n' "$*"
}

die() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

dry_run=0
if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=1
  shift
fi
[[ $# -eq 0 ]] || die "usage: bash deploy.sh [--dry-run]"

for command in git pnpm tar scp ssh; do
  command -v "$command" >/dev/null 2>&1 || die "missing command: $command"
done

git diff --quiet || die "tracked working-tree changes are present"
git diff --cached --quiet || die "staged changes are present"

expected_branch="${SALARY_DEPLOY_BRANCH:-main}"
branch="$(git branch --show-current)"
if (( dry_run )); then
  log "dry-run on branch $branch; skipping remote branch equality gate"
else
  [[ "$branch" == "$expected_branch" ]] || die "deploy only runs from $expected_branch (current: $branch)"
  log "refreshing origin/$expected_branch"
  git fetch --quiet origin "$expected_branch"
fi
commit="$(git rev-parse HEAD)"
if (( ! dry_run )); then
  origin_commit="$(git rev-parse "origin/$expected_branch")"
  [[ "$commit" == "$origin_commit" ]] || die "HEAD $commit is not origin/$expected_branch $origin_commit"
fi

log "running quality gates"
pnpm architecture:check
pnpm test
pnpm typecheck
pnpm build
pnpm --filter @salary/worker build

stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/salary-slip-stage.XXXXXX")"
package_dir="$(mktemp -d "${TMPDIR:-/tmp}/salary-slip-package.XXXXXX")"
archive_name="salary-slip-${commit}.tar.gz"
archive_path="$package_dir/$archive_name"
cleanup() {
  rm -rf -- "$stage_dir" "$package_dir"
}
trap cleanup EXIT

log "assembling release $commit"
git archive --format=tar HEAD | tar -xf - -C "$stage_dir"
for directory in \
  apps/api/dist \
  apps/web/dist \
  apps/worker/dist \
  packages/db/dist \
  packages/domain/dist \
  packages/dingtalk/dist; do
  [[ -d "$ROOT_DIR/$directory" ]] || die "missing build output: $directory"
  mkdir -p "$stage_dir/$directory"
  cp -a "$ROOT_DIR/$directory/." "$stage_dir/$directory/"
done
printf '%s\n' "$commit" > "$stage_dir/RELEASE_COMMIT"
tar -czf "$archive_path" -C "$stage_dir" .

if tar -tzf "$archive_path" | grep -E '(^|/)\.env($|/)|node_modules|\.superpowers|salary-slip-internal-app-20260818\.zip|\.sqlite($|/)' >/dev/null; then
  die "release archive contains a forbidden secret, dependency cache, database, or local artifact"
fi

log "release archive: $archive_path ($(du -h "$archive_path" | awk '{print $1}'))"
if (( dry_run )); then
  log "dry-run complete; no remote state changed"
  exit 0
fi

deploy_host="${SALARY_DEPLOY_HOST:-root@47.107.92.14}"
remote_base="${SALARY_DEPLOY_BASE:-/opt/salary-slip}"
public_url="${SALARY_DEPLOY_URL:-https://salary.tanjiabi.cc}"
local_health_url="${SALARY_DEPLOY_LOCAL_HEALTH_URL:-http://127.0.0.1:3100/healthz}"
service_name="${SALARY_DEPLOY_SERVICE:-salary-slip.service}"
nginx_user="${SALARY_DEPLOY_NGINX_USER:-www-data}"
remote_archive="/tmp/$archive_name"

log "uploading release to $deploy_host"
scp -q "$archive_path" "$deploy_host:$remote_archive"

ssh "$deploy_host" bash -s -- \
  "$commit" "$remote_archive" "$remote_base" "$public_url" "$local_health_url" "$service_name" "$nginx_user" <<'REMOTE'
set -Eeuo pipefail

commit="$1"
archive="$2"
base="$3"
public_url="$4"
local_health_url="$5"
service_name="$6"
nginx_user="$7"
release="$base/releases/$commit"
previous="$(readlink -f "$base/current")"
switched=0

fail() {
  printf '[remote deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

ensure_web_readable() {
  chmod 755 "$release"
  find "$release/apps/web/dist" -type d -exec chmod 755 {} +
  find "$release/apps/web/dist" -type f -exec chmod 644 {} +
  runuser -u "$nginx_user" -- test -r "$release/apps/web/dist/index.html" \
    || fail "Nginx user cannot read web index"
}

rollback() {
  if (( switched )); then
    ln -sfn "$previous" "$base/.current-rollback"
    mv -Tf "$base/.current-rollback" "$base/current"
    systemctl restart "$service_name" || true
  fi
}

test -f "$archive" || fail "missing uploaded archive: $archive"
test -d "$base/current" || fail "missing current release: $base/current"

if [[ "$(readlink -f "$base/current")" != "$release" ]]; then
  test ! -e "$release" || fail "release already exists but is not current: $release"
  mkdir -p "$base/releases"
  cp -a "$previous" "$release"
  tar -xzf "$archive" -C "$release"
  test "$(cat "$release/RELEASE_COMMIT")" = "$commit" || fail "release marker mismatch"
  chown -R --no-dereference salary-slip:salary-slip "$release"
  ensure_web_readable
  nginx -t
  ln -sfn "$release" "$base/.current-$commit"
  mv -Tf "$base/.current-$commit" "$base/current"
  switched=1
  systemctl restart "$service_name"
else
  release="$base/current"
  ensure_web_readable
fi

ready=0
health_file="/tmp/salary-slip-healthz-$commit.json"
for attempt in $(seq 1 30); do
  if systemctl is-active --quiet "$service_name" && curl --fail --silent --show-error --max-time 2 "$local_health_url" > "$health_file"; then
    ready=1
    break
  fi
  sleep 1
done
if (( ! ready )); then
  rollback
  systemctl --no-pager --full status "$service_name" >&2 || true
  journalctl -u "$service_name" -n 40 --no-pager >&2 || true
  fail "local health check did not become ready"
fi

home_status="$(curl --silent --show-error --max-time 10 -k -o /dev/null -w '%{http_code}' "$public_url/")"
if [[ "$home_status" != "200" ]]; then
  rollback
  fail "public home returned HTTP $home_status"
fi
if ! curl --fail --silent --show-error --max-time 10 "$public_url/healthz" >/dev/null; then
  rollback
  fail "public health check failed"
fi

printf 'previous=%s\ncurrent=%s\n' "$previous" "$(readlink -f "$base/current")"
printf 'service=%s\n' "$(systemctl is-active "$service_name")"
printf 'home_status=%s\n' "$home_status"
printf 'health='; cat "$health_file"; printf '\n'
rm -f "$archive" "$health_file"
REMOTE

log "deployment completed: $commit"
