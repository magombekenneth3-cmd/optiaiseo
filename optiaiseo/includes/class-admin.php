<?php
defined('ABSPATH') || exit;

class OptiAISEO_Admin
{

	public static function init(): void
	{
		add_action('admin_menu', [__CLASS__, 'add_menu']);
		add_action('admin_init', [__CLASS__, 'register_settings']);
		add_action('admin_notices', [__CLASS__, 'connection_notice']);
		add_action('wp_ajax_optiaiseo_test_connection', [__CLASS__, 'ajax_test_connection']);
		add_action('wp_ajax_optiaiseo_refresh_post', [__CLASS__, 'ajax_refresh_post']);
		add_action('wp_ajax_optiaiseo_inject_schema', [__CLASS__, 'ajax_inject_schema']);
	}

	public static function add_menu(): void
	{
		add_options_page(
			__('OptiAISEO Settings', 'optiaiseo'),
			'OptiAISEO',
			'manage_options',
			'optiaiseo',
			[__CLASS__, 'render_settings_page']
		);
	}

	public static function register_settings(): void
	{
		register_setting('optiaiseo_settings', 'optiaiseo_api_key', [
			'sanitize_callback' => 'sanitize_text_field',
		]);
		register_setting('optiaiseo_settings', 'optiaiseo_site_id', [
			'sanitize_callback' => 'sanitize_text_field',
		]);
		register_setting('optiaiseo_settings', 'optiaiseo_auto_inject_schema', [
			'sanitize_callback' => 'rest_sanitize_boolean',
			'default' => false,
		]);
	}

	public static function render_settings_page(): void
	{
		$api_key = get_option('optiaiseo_api_key');
		$site_id = get_option('optiaiseo_site_id');
		$connected = $api_key && $site_id;
		?>
		<div class="wrap">
			<h1><?php esc_html_e('OptiAISEO', 'optiaiseo'); ?></h1>
			<p class="description">
				<?php esc_html_e('Connect your WordPress site to OptiAISEO to see AI Visibility scores per post and inject schema markup automatically.', 'optiaiseo'); ?>
			</p>

			<?php if ($connected): ?>
				<div class="notice notice-success inline">
					<p>
							<?php esc_html_e('Connected to OptiAISEO.', 'optiaiseo'); ?>
						<button type="button" class="button-link" id="optiaiseo-test-btn">
								<?php esc_html_e('Test connection', 'optiaiseo'); ?>
						</button>
						<span id="optiaiseo-test-result" style="margin-left:8px;"></span>
					</p>
				</div>
			<?php endif; ?>

			<form method="post" action="options.php" style="max-width:600px;margin-top:24px;">
				<?php settings_fields('optiaiseo_settings'); ?>

				<table class="form-table" role="presentation">
					<tr>
						<th scope="row">
							<label for="optiaiseo_api_key"><?php esc_html_e('API Key', 'optiaiseo'); ?></label>
						</th>
						<td>
							<input type="password" id="optiaiseo_api_key" name="optiaiseo_api_key"
								value="<?php echo esc_attr($api_key); ?>" class="regular-text" autocomplete="off"
								placeholder="oaiseo_..." />
							<p class="description">
								<?php printf(
									wp_kses(
										__('Find your API key at <a href="%s" target="_blank">optiaiseo.com/dashboard/settings</a>.', 'optiaiseo'),
										['a' => ['href' => [], 'target' => []]]
									),
									'https://optiaiseo.com/dashboard/settings'
								); ?>
							</p>
						</td>
					</tr>
					<tr>
						<th scope="row">
							<label for="optiaiseo_site_id"><?php esc_html_e('Site ID', 'optiaiseo'); ?></label>
						</th>
						<td>
							<input type="text" id="optiaiseo_site_id" name="optiaiseo_site_id"
								value="<?php echo esc_attr($site_id); ?>" class="regular-text"
								placeholder="clxxxxxxxxxxxxxxxxxxxxxxx" />
							<p class="description">
								<?php esc_html_e('The Site ID from your OptiAISEO dashboard (Settings → WordPress Plugin).', 'optiaiseo'); ?>
							</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e('Auto-inject schema', 'optiaiseo'); ?></th>
						<td>
							<label>
								<input type="checkbox" name="optiaiseo_auto_inject_schema" value="1" <?php checked(get_option('optiaiseo_auto_inject_schema')); ?> /> <?php esc_html_e('Automatically inject suggested schema markup into post <head> on publish', 'optiaiseo'); ?> </label>
								<p class="description">
									<?php esc_html_e('When enabled, OptiAISEO adds JSON-LD schema to posts that are missing it.', 'optiaiseo'); ?>
								</p>
						</td>
					</tr>
				</table>

				<?php submit_button(); ?>
			</form>

			<hr />
			<h2><?php esc_html_e('How it works', 'optiaiseo'); ?></h2>
			<ol style="max-width:600px;line-height:1.8;">
				<li><?php esc_html_e('Enter your API Key and Site ID above and save.', 'optiaiseo'); ?></li>
				<li><?php esc_html_e('Go to Posts → All Posts to see AI Visibility scores in the new column.', 'optiaiseo'); ?>
				</li>
				<li><?php esc_html_e('Open any post to see the OptiAISEO sidebar with score, failing checks, and one-click schema injection.', 'optiaiseo'); ?>
				</li>
				<li><?php esc_html_e('Scores refresh weekly automatically. Click "Refresh score" in the sidebar for an immediate update.', 'optiaiseo'); ?>
				</li>
			</ol>
		</div>

		<script>
			document.getElementById('optiaiseo-test-btn')?.addEventListener('click', function () {
				const btn = this;
				const result = document.getElementById('optiaiseo-test-result');
				btn.disabled = true;
				result.textContent = '<?php echo esc_js(__('Testing…', 'optiaiseo')); ?>';
				fetch(ajaxurl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body: new URLSearchParams({
						action: 'optiaiseo_test_connection',
						nonce: '<?php echo esc_js(wp_create_nonce('optiaiseo_test')); ?>'
					})
				})
					.then(r => r.json())
					.then(data => {
						result.textContent = data.success ? '✓ ' + data.data.message : '✗ ' + (data.data?.message ?? 'Connection failed');
						result.style.color = data.success ? '#00a32a' : '#d63638';
					})
					.finally(() => { btn.disabled = false; });
			});
		</script>
		<?php
	}

	public static function connection_notice(): void
	{
		$screen = get_current_screen();
		if ($screen && $screen->id === 'settings_page_optiaiseo')
			return;
		if (get_option('optiaiseo_api_key') && get_option('optiaiseo_site_id'))
			return;
		printf(
			'<div class="notice notice-warning is-dismissible"><p>%s <a href="%s">%s</a></p></div>',
			esc_html__('OptiAISEO is not connected.', 'optiaiseo'),
			esc_url(admin_url('options-general.php?page=optiaiseo')),
			esc_html__('Connect now →', 'optiaiseo')
		);
	}

	public static function ajax_test_connection(): void
	{
		check_ajax_referer('optiaiseo_test', 'nonce');
		if (!current_user_can('manage_options'))
			wp_send_json_error(['message' => 'Forbidden']);

		$response = wp_remote_get(
			OPTIAISEO_API_BASE . '/ping',
			[
				'timeout' => 10,
				'headers' => ['Authorization' => 'Bearer ' . get_option('optiaiseo_api_key')],
			]
		);

		if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) {
			wp_send_json_error(['message' => __('Could not reach OptiAISEO API. Check your API key.', 'optiaiseo')]);
		}

		$body = json_decode(wp_remote_retrieve_body($response), true);
		wp_send_json_success([
			'message' => sprintf(
				__('Connected — site: %s', 'optiaiseo'),
				$body['domain'] ?? '?'
			)
		]);
	}

	public static function ajax_refresh_post(): void
	{
		check_ajax_referer('optiaiseo_refresh', 'nonce');
		if (!current_user_can('edit_posts'))
			wp_send_json_error();

		$post_id = absint($_POST['post_id'] ?? 0);
		if (!$post_id)
			wp_send_json_error(['message' => 'Missing post_id']);

		$result = optiaiseo_refresh_post_score($post_id);
		if (!$result) {
			wp_send_json_error(['message' => __('Score refresh failed. Check your API key and Site ID.', 'optiaiseo')]);
		}

		wp_send_json_success($result);
	}

	public static function ajax_inject_schema(): void
	{
		check_ajax_referer('optiaiseo_schema', 'nonce');
		if (!current_user_can('edit_posts'))
			wp_send_json_error();

		$post_id = absint($_POST['post_id'] ?? 0);
		$schema_html = get_post_meta($post_id, '_optiaiseo_schema_html', true);

		if (!$post_id || !$schema_html) {
			wp_send_json_error(['message' => __('No schema suggestion available. Refresh the score first.', 'optiaiseo')]);
		}

		update_post_meta($post_id, '_optiaiseo_injected_schema', $schema_html);
		update_post_meta($post_id, '_optiaiseo_schema_injected_at', time());

		wp_send_json_success(['message' => __('Schema injected into <head>.', 'optiaiseo')]);
	}
}
