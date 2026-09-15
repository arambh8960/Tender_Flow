import { supabase } from '../client';
import { unwrap, unwrapList, unwrapMaybe } from './base';
import type { Tables, UpdateDto, OrgRole } from '../../../../database.types';

export type Organization = Tables<'organizations'>;
export type OrganizationMember = Tables<'organization_members'>;
export type OrganizationProfile = Tables<'organization_profiles'>;
export type OrganizationModule = Tables<'organization_modules'>;

/** A membership joined with its organisation — the unit the UI works with. */
export interface MembershipWithOrg {
  membership: OrganizationMember;
  organization: Organization;
}

export const OrganizationRepository = {
  /**
   * Creates an organisation and makes the caller its owner, atomically.
   * Goes through the create_organization RPC rather than two inserts: an
   * INSERT policy on organization_members permissive enough for the client
   * to grant itself a role would be a privilege-escalation hole.
   */
  async create(name: string, industry?: string | null, slug?: string | null): Promise<Organization> {
    const res = await supabase.rpc('create_organization', {
      p_name: name,
      p_slug: slug ?? null,
      p_industry: industry ?? null,
    });
    return unwrap(res as { data: Organization | null; error: any });
  },

  /** Every organisation the signed-in user belongs to. RLS scopes this. */
  async listMine(): Promise<MembershipWithOrg[]> {
    const res = await supabase
      .from('organization_members')
      .select('*, organizations(*)')
      .eq('status', 'active')
      .order('created_at', { ascending: true });

    const rows = unwrapList(res as { data: any[] | null; error: any });
    return rows
      .filter(r => r.organizations)
      .map(r => {
        const { organizations, ...membership } = r;
        return { membership: membership as OrganizationMember, organization: organizations as Organization };
      });
  },

  async getById(organizationId: string): Promise<Organization | null> {
    return unwrapMaybe(
      await supabase.from('organizations').select('*').eq('id', organizationId).single()
    );
  },

  async update(organizationId: string, patch: UpdateDto<'organizations'>): Promise<Organization> {
    return unwrap(
      await supabase.from('organizations').update(patch).eq('id', organizationId).select().single()
    );
  },

  async getProfile(organizationId: string): Promise<OrganizationProfile | null> {
    return unwrapMaybe(
      await supabase.from('organization_profiles').select('*').eq('organization_id', organizationId).single()
    );
  },

  async upsertProfile(
    organizationId: string,
    patch: UpdateDto<'organization_profiles'>
  ): Promise<OrganizationProfile> {
    return unwrap(
      await supabase
        .from('organization_profiles')
        .upsert({ ...patch, organization_id: organizationId }, { onConflict: 'organization_id' })
        .select()
        .single()
    );
  },

  async listModules(organizationId: string): Promise<OrganizationModule[]> {
    return unwrapList(
      await supabase
        .from('organization_modules')
        .select('*')
        .eq('organization_id', organizationId)
        .order('module_key')
    );
  },

  async setModuleEnabled(organizationId: string, moduleKey: string, enabled: boolean): Promise<void> {
    const res = await supabase
      .from('organization_modules')
      .update({ enabled })
      .eq('organization_id', organizationId)
      .eq('module_key', moduleKey);
    if (res.error) throw res.error;
  },
};

export const MembershipRepository = {
  async listForOrganization(organizationId: string): Promise<(OrganizationMember & { profile: Tables<'profiles'> | null })[]> {
    const res = await supabase
      .from('organization_members')
      .select('*, profiles(*)')
      .eq('organization_id', organizationId)
      .order('created_at');

    const rows = unwrapList(res as { data: any[] | null; error: any });
    return rows.map(r => {
      const { profiles, ...rest } = r;
      return { ...(rest as OrganizationMember), profile: (profiles as Tables<'profiles'>) ?? null };
    });
  },

  async setRole(membershipId: string, role: OrgRole): Promise<void> {
    const res = await supabase.from('organization_members').update({ role }).eq('id', membershipId);
    if (res.error) throw res.error;
  },

  async remove(membershipId: string): Promise<void> {
    const res = await supabase.from('organization_members').delete().eq('id', membershipId);
    if (res.error) throw res.error;
  },
};

export const ProfileRepository = {
  async getMine(userId: string): Promise<Tables<'profiles'> | null> {
    return unwrapMaybe(await supabase.from('profiles').select('*').eq('id', userId).single());
  },

  async update(userId: string, patch: UpdateDto<'profiles'>): Promise<Tables<'profiles'>> {
    return unwrap(await supabase.from('profiles').update(patch).eq('id', userId).select().single());
  },
};
