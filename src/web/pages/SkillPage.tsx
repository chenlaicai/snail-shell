import { useQuery } from '@tanstack/react-query';
import { skillQueries } from '../queries/skill.queries.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';

export function SkillPage() {
  const { data: skills, isLoading, error } = useQuery(skillQueries.list());

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Skill Center</h1>
        <Button variant="outline" size="sm">Refresh</Button>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading...</p>}
      {error && <p className="text-destructive">{error.message}</p>}

      <div className="space-y-3">
        {skills?.map((skill: { name: string; description: string; source: string }) => (
          <div
            key={skill.name}
            className="border rounded-lg p-4 hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium">{skill.name}</span>
              <Badge variant={skill.source === 'platform' ? 'default' : 'secondary'}>
                {skill.source}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{skill.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
