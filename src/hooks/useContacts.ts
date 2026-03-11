import { useInfiniteQuery } from '@tanstack/react-query'

import { userApi } from '../api/user.api'
import { queryKeys } from '../constants/queryKeys'

export function useContacts(search: string = '') {
  return useInfiniteQuery({
    queryKey: [...queryKeys.users.all, search],
    queryFn: ({ pageParam = 1 }) =>
      userApi.getAll({ page: pageParam as number, limit: 20, search }),
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
    initialPageParam: 1,
  })
}
