-- Optional: number of scout agents to create on DP startup (0 = only use agents created in Admin with Scout profile)
INSERT INTO system_settings (tenant_id, category, key, value, description, value_type)
VALUES (NULL, 'system', 'default_scout_agent_count', to_jsonb(0), 'Default scout (watcher) agents to spawn; 0 = use only agents assigned Scout profile in Admin', 'number')
ON CONFLICT DO NOTHING;
