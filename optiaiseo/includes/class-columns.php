<?php
defined('ABSPATH') || exit;

class OptiAISEO_Columns
{

	public static function init(): void
	{
		add_filter('manage_posts_columns', [__CLASS__, 'add_column']);
		add_action('manage_posts_custom_column', [__CLASS__, 'render_column'], 10, 2);
		add_filter('manage_edit-post_sortable_columns', [__CLASS__, 'make_sortable']);
		add_action('pre_get_posts', [__CLASS__, 'sort_by_score']);
		add_action('admin_enqueue_scripts', [__CLASS__, 'enqueue_styles']);
	}

	public static function add_column(array $cols): array
	{
		$new = [];
		foreach ($cols as $key => $label) {
			$new[$key] = $label;
			if ($key === 'title') {
				$new['optiaiseo_score'] = '<span title="AI Visibility Score">AI Score</span>';
			}
		}
		return $new;
	}

	public static function render_column(string $col, int $post_id): void
	{
		if ($col !== 'optiaiseo_score')
			return;

		$score = get_post_meta($post_id, '_optiaiseo_score', true);
		$grade = get_post_meta($post_id, '_optiaiseo_grade', true);
		$synced = get_post_meta($post_id, '_optiaiseo_synced_at', true);

		if ('' === $score || false === $score) {
			echo '<span class="oaiseo-na" title="Not yet scored — open post to refresh">—</span>';
			return;
		}

		$score = (int) $score;
		$grade = $grade ?: 'F';
		$cls = $score >= 75 ? 'oaiseo-grade-a'
			: ($score >= 55 ? 'oaiseo-grade-b'
				: ($score >= 35 ? 'oaiseo-grade-c' : 'oaiseo-grade-d'));

		$age = $synced ? human_time_diff((int) $synced, time()) . ' ago' : 'never';

		printf(
			'<div class="oaiseo-col" title="Last synced: %s">
				<span class="oaiseo-score">%d</span>
				<span class="oaiseo-badge %s">%s</span>
			</div>',
			esc_attr($age),
			esc_html($score),
			esc_attr($cls),
			esc_html($grade)
		);
	}

	public static function make_sortable(array $cols): array
	{
		$cols['optiaiseo_score'] = 'optiaiseo_score';
		return $cols;
	}

	public static function sort_by_score(\WP_Query $query): void
	{
		if (!is_admin() || !$query->is_main_query())
			return;
		if ($query->get('orderby') !== 'optiaiseo_score')
			return;
		$query->set('meta_key', '_optiaiseo_score');
		$query->set('orderby', 'meta_value_num');
	}

	public static function enqueue_styles(string $hook): void
	{
		if (!in_array($hook, ['edit.php', 'post.php', 'post-new.php'], true))
			return;
		wp_add_inline_style('wp-admin', '
			.oaiseo-col { display:flex; align-items:center; gap:6px; }
			.oaiseo-score { font-size:15px; font-weight:700; color:#1d2327; }
			.oaiseo-badge { font-size:10px; font-weight:700; padding:2px 6px; border-radius:3px; }
			.oaiseo-grade-a { background:#d7f7e0; color:#0a7227; }
			.oaiseo-grade-b { background:#d7eeff; color:#0a4b8a; }
			.oaiseo-grade-c { background:#fff3cd; color:#7a4700; }
			.oaiseo-grade-d { background:#fde8e8; color:#8a0a0a; }
			.oaiseo-na { color:#999; font-size:12px; }
			.column-optiaiseo_score { width:90px; }
		');
	}
}
